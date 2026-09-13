// Whisper backend for the composer mic.
//
// Cursor's built-in dictation is a streaming Whisper-class STT service, not
// Apple's `SFSpeechRecognizer`. We cannot call Cursor's private endpoint, so
// this talks to the same *kind* of model:
//
//   1. Groq / OpenAI Whisper, when a key is in the environment or a local file
//   2. A long-lived `whisper-server` (whisper.cpp) with ggml-small
//   3. One-shot `whisper-cli`, then the Python `whisper` CLI as last resort
//
// The recorder keeps a 16 kHz mono PCM buffer and re-sends it, so the page
// sees a growing transcript the way Cursor's live STT does — without Apple's
// silence-endpointed segments.

import Darwin
import Foundation

enum WhisperError: LocalizedError {
    case noBackend
    case download(String)
    case transcribe(String)

    var errorDescription: String? {
        switch self {
        case .noBackend:
            return "没有可用的 Whisper 后端。安装 whisper-cpp（brew install whisper-cpp），或把 GROQ_API_KEY / OPENAI_API_KEY 写进环境变量或 ~/Library/Application Support/DeepSeekHarness/groq.key"
        case .download(let message), .transcribe(let message):
            return message
        }
    }
}

final class WhisperEngine {
    static let shared = WhisperEngine()

    private let sync = DispatchQueue(label: "dsh.whisper.engine")
    private var backend: Backend?
    private let readyLock = NSLock()
    private var readyFlag = false
    private var cliFallback: (cli: URL, model: URL)?
    private var server: Process?
    private var serverPort = 18_789
    private var preparing = false
    private var prepareWaiters: [(Result<Void, Error>) -> Void] = []

    private enum Backend {
        case groq(String)
        case openai(String)
        case localServer(URL)
        case localCLI(cli: URL, model: URL)
        case python(URL)

        var label: String {
            switch self {
            case .groq: return "groq"
            case .openai: return "openai"
            case .localServer: return "whisper-server"
            case .localCLI: return "whisper-cli"
            case .python: return "python-whisper"
            }
        }

        var canFallBackToCLI: Bool {
            if case .localServer = self { return true }
            return false
        }
    }

    private init() {}

    /// Resolve a backend once per process. Safe to call again — waiters share
    /// the in-flight prepare, and a ready backend returns immediately.
    func prepare(progress: @escaping (String) -> Void, completion: @escaping (Result<Void, Error>) -> Void) {
        sync.async {
            if self.backend != nil {
                DispatchQueue.main.async { completion(.success(())) }
                return
            }
            self.prepareWaiters.append(completion)
            guard !self.preparing else { return }
            self.preparing = true
            self.resolve(progress: progress) { result in
                self.sync.async {
                    self.preparing = false
                    if case .success(let backend) = result {
                        self.backend = backend
                        self.readyLock.lock()
                        self.readyFlag = true
                        self.readyLock.unlock()
                    }
                    let waiters = self.prepareWaiters
                    self.prepareWaiters = []
                    let forwarded: Result<Void, Error> = result.map { _ in () }
                    DispatchQueue.main.async {
                        waiters.forEach { $0(forwarded) }
                    }
                }
            }
        }
    }

    func transcribe(wav: Data, completion: @escaping (Result<String, Error>) -> Void) {
        sync.async {
            guard let backend = self.backend else {
                VoiceLog.line("transcribe: no backend")
                completion(.failure(WhisperError.noBackend))
                return
            }
            VoiceLog.line("transcribe: \(wav.count) bytes via \(backend.label)")
            self.run(backend, wav: wav) { result in
                if case .failure(let error) = result, let fallback = self.cliFallback, backend.canFallBackToCLI {
                    VoiceLog.line("transcribe server failed (\(error.localizedDescription)); trying whisper-cli")
                    DispatchQueue.global(qos: .userInitiated).async {
                        completion(self.runCLI(fallback.cli, model: fallback.model, wav: wav))
                    }
                    return
                }
                if case .failure(let error) = result {
                    VoiceLog.line("transcribe failed: \(error.localizedDescription)")
                }
                completion(result)
            }
        }
    }

    var isReady: Bool {
        readyLock.lock()
        defer { readyLock.unlock() }
        return readyFlag
    }

    func shutdown() {
        sync.sync {
            server?.terminate()
            server = nil
            backend = nil
            self.readyLock.lock()
            self.readyFlag = false
            self.readyLock.unlock()
        }
    }

    /// Strip the tokens Whisper emits on silence or music so they never land
    /// in the composer. Chinese is folded to simplified.
    static func clean(_ raw: String) -> String {
        var text = raw
        let junk = [
            "[BLANK_AUDIO]", "[blank_audio]", "[Blank audio]",
            "(blank)", "(BLANK)",
            "[Music]", "[music]", "[音乐]", "[MUSIC]",
            "[Silence]", "[silence]", "[silence]",
            "[INAUDIBLE]", "[inaudible]",
        ]
        for token in junk {
            text = text.replacingOccurrences(of: token, with: "")
        }
        if let regex = try? NSRegularExpression(pattern: #"\[[0-9:.]+[[:space:]]*-->[[:space:]]*[0-9:.]+\]"#) {
            let range = NSRange(text.startIndex..., in: text)
            text = regex.stringByReplacingMatches(in: text, options: [], range: range, withTemplate: "")
        }
        text = text
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if text.count >= 2, (text.first == "\"" && text.last == "\"") || (text.first == "“" && text.last == "”") {
            text = String(text.dropFirst().dropLast()).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        let prompt = "以下是简体中文听写。"
        if text == prompt { return "" }
        if text.hasPrefix(prompt) {
            text = String(text.dropFirst(prompt.count)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        if isHallucination(text) { return "" }
        return ZhHans.convert(text)
    }

    /// YouTube-caption leftovers and empty-room babble. These must not be
    /// committed — they are why the box kept growing while nobody spoke.
    static func isHallucination(_ text: String) -> Bool {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return true }
        if (trimmed.hasPrefix("(") && trimmed.hasSuffix(")"))
            || (trimmed.hasPrefix("（") && trimmed.hasSuffix("）"))
        {
            return true
        }
        let lower = trimmed.lowercased()
        let marks = [
            "字幕", "字幕制作", "字幕製作", "中文字幕",
            "谢谢大家", "謝謝大家", "谢谢收看", "謝謝收看",
            "请不吝点赞", "請不吝點贊",
            "thank you for watching", "thanks for watching",
            "please subscribe", "j chong", "j.chong",
            "贝尔", "貝爾",
        ]
        if marks.contains(where: { lower.contains($0) }) { return true }
        if trimmed.count >= 8 {
            let unique = Set(trimmed)
            if unique.count <= 2 { return true }
        }
        return false
    }

    // MARK: - resolve

    private func resolve(progress: @escaping (String) -> Void, done: @escaping (Result<Backend, Error>) -> Void) {
        if let cloud = Self.cloudBackend() {
            done(.success(cloud))
            return
        }

        let path = Shell.launchPATH()
        let serverBin = Self.which("whisper-server", path: path)
        let cliBin = Self.which("whisper-cli", path: path)
        let pythonBin = Self.which("whisper", path: path)

        if serverBin != nil || cliBin != nil {
            progress("正在准备 Whisper 模型…")
            ensureModel(progress: progress) { result in
                switch result {
                case .failure(let error):
                    if let pythonBin {
                        done(.success(.python(pythonBin)))
                    } else {
                        done(.failure(error))
                    }
                case .success(let model):
                    if let cliBin { self.cliFallback = (cliBin, model) }
                    if let serverBin, let url = self.startServer(serverBin, model: model, progress: progress) {
                        VoiceLog.line("backend=whisper-server model=\(model.lastPathComponent)")
                        done(.success(.localServer(url)))
                        return
                    }
                    if let cliBin {
                        VoiceLog.line("backend=whisper-cli model=\(model.lastPathComponent)")
                        done(.success(.localCLI(cli: cliBin, model: model)))
                        return
                    }
                    if let pythonBin {
                        done(.success(.python(pythonBin)))
                        return
                    }
                    done(.failure(WhisperError.noBackend))
                }
            }
            return
        }

        if let pythonBin {
            done(.success(.python(pythonBin)))
            return
        }
        done(.failure(WhisperError.noBackend))
    }

    // MARK: - cloud keys

    private static func cloudBackend() -> Backend? {
        if let key = secret("GROQ_API_KEY", files: ["groq.key"]) { return .groq(key) }
        if let key = secret("OPENAI_API_KEY", files: ["openai.key"]) { return .openai(key) }
        return nil
    }

    private static func secret(_ envName: String, files: [String]) -> String? {
        if let value = ProcessInfo.processInfo.environment[envName]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !value.isEmpty
        {
            return value
        }
        let homes = [
            ServerRecord.directory,
            URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".config/deepseek-harness"),
        ]
        for dir in homes {
            for name in files {
                let url = dir.appendingPathComponent(name)
                if let raw = try? String(contentsOf: url, encoding: .utf8) {
                    let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
                    if !value.isEmpty { return value }
                }
            }
            let envFile = dir.appendingPathComponent("whisper.env")
            if let parsed = parseEnv(envFile)[envName], !parsed.isEmpty {
                return parsed
            }
        }
        return loginEnv(envName)
    }

    private static func parseEnv(_ url: URL) -> [String: String] {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return [:] }
        var out: [String: String] = [:]
        for line in raw.split(whereSeparator: \.isNewline) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
            let parts = trimmed.split(separator: "=", maxSplits: 1)
            guard parts.count == 2 else { continue }
            let key = parts[0].trimmingCharacters(in: .whitespaces)
            var value = parts[1].trimmingCharacters(in: .whitespaces)
            if (value.hasPrefix("\"") && value.hasSuffix("\"")) || (value.hasPrefix("'") && value.hasSuffix("'")) {
                value = String(value.dropFirst().dropLast())
            }
            out[key] = value
        }
        return out
    }

    /// GUI apps launched from Finder do not inherit the login-shell env.
    private static func loginEnv(_ name: String) -> String? {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/zsh")
        proc.arguments = ["-lc", "printf %s \"${\(name)}\""]
        let out = Pipe()
        proc.standardOutput = out
        proc.standardError = Pipe()
        do { try proc.run() } catch { return nil }
        let deadline = Date().addingTimeInterval(1.6)
        while proc.isRunning, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.05)
        }
        if proc.isRunning {
            proc.terminate()
            return nil
        }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        let value = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.isEmpty ? nil : value
    }

    // MARK: - model

    private static var bundledModelName: String { "ggml-small.bin" }

    private static var modelURL: URL {
        if let explicit = ProcessInfo.processInfo.environment["WHISPER_MODEL_PATH"],
           FileManager.default.isReadableFile(atPath: explicit)
        {
            return URL(fileURLWithPath: explicit)
        }
        return ServerRecord.directory
            .appendingPathComponent("whisper", isDirectory: true)
            .appendingPathComponent(bundledModelName)
    }

    private static let modelMirrors: [String] = [
        "https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        "https://ggml.ggerganov.com/ggml-model-whisper-small.bin",
    ]

    private func ensureModel(progress: @escaping (String) -> Void, completion: @escaping (Result<URL, Error>) -> Void) {
        let dest = Self.modelURL
        if Self.looksLikeModel(dest) {
            completion(.success(dest))
            return
        }
        try? FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
        let urls = Self.modelMirrors.compactMap(URL.init(string:))
        FileDownloader.fetch(urls: urls, to: dest, progress: progress) { result in
            switch result {
            case .success:
                if Self.looksLikeModel(dest) {
                    completion(.success(dest))
                } else {
                    try? FileManager.default.removeItem(at: dest)
                    completion(.failure(WhisperError.download("下载的 Whisper 模型无效，请重试或手动放置 ggml-small.bin")))
                }
            case .failure(let error):
                completion(.failure(error))
            }
        }
    }

    private static func looksLikeModel(_ url: URL) -> Bool {
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
              let size = attrs[.size] as? NSNumber,
              size.int64Value > 80_000_000
        else { return false }
        guard let handle = try? FileHandle(forReadingFrom: url) else { return false }
        defer { try? handle.close() }
        let magic = handle.readData(ofLength: 4)
        // On-disk GGML magic is little-endian `ggml` → bytes `lmgg`.
        let marks: [Data] = ["ggml", "ggmf", "ggjt", "lmgg", "fmgg", "tjgg"].map { Data($0.utf8) }
        return marks.contains(magic)
    }

    // MARK: - local server

    private func startServer(_ bin: URL, model: URL, progress: @escaping (String) -> Void) -> URL? {
        if let server, server.isRunning, let existing = probeServer(port: serverPort) {
            return existing
        }
        server?.terminate()
        server = nil
        Self.freePort(serverPort)
        progress("正在启动 Whisper…")
        let proc = Process()
        proc.executableURL = bin
        proc.arguments = [
            "-m", model.path,
            "--host", "127.0.0.1",
            "--port", "\(serverPort)",
            "-l", "auto",
            "-nth", "0.75",
            "--inference-path", "/inference",
            "-nt",
            "-sns",
        ]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = Shell.launchPATH()
        proc.environment = env
        // Unread pipes fill up (~64KB) and the process blocks on write —
        // inference then hangs forever while the mic meter still animates.
        Self.attachLog(proc, name: "whisper-server.log")
        do {
            try proc.run()
        } catch {
            VoiceLog.line("whisper-server spawn failed: \(error.localizedDescription)")
            return nil
        }
        server = proc
        let deadline = Date().addingTimeInterval(45)
        while Date() < deadline, proc.isRunning {
            if let url = probeServer(port: serverPort) {
                VoiceLog.line("whisper-server up on \(url.absoluteString)")
                return url
            }
            Thread.sleep(forTimeInterval: 0.2)
        }
        if !proc.isRunning {
            VoiceLog.line("whisper-server exited before listen")
            server = nil
        }
        return probeServer(port: serverPort)
    }

    private func probeServer(port: Int) -> URL? {
        // `/` serves a static folder that brew's binary does not ship.
        // `/inference` exists as soon as the HTTP listener is up (400/405 is fine).
        let url = URL(string: "http://127.0.0.1:\(port)/inference")!
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 0.6
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        URLSession.shared.dataTask(with: request) { _, response, _ in
            if let http = response as? HTTPURLResponse, (200 ..< 500).contains(http.statusCode) {
                ok = true
            }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 0.8)
        return ok ? URL(string: "http://127.0.0.1:\(port)") : nil
    }

    // MARK: - run

    private func run(_ backend: Backend, wav: Data, completion: @escaping (Result<String, Error>) -> Void) {
        switch backend {
        case .groq(let key):
            postOpenAI(
                url: URL(string: "https://api.groq.com/openai/v1/audio/transcriptions")!,
                key: key,
                model: "whisper-large-v3-turbo",
                wav: wav,
                completion: completion
            )
        case .openai(let key):
            postOpenAI(
                url: URL(string: "https://api.openai.com/v1/audio/transcriptions")!,
                key: key,
                model: "whisper-1",
                wav: wav,
                completion: completion
            )
        case .localServer(let base):
            postLocal(base: base, wav: wav, completion: completion)
        case .localCLI(let cli, let model):
            DispatchQueue.global(qos: .userInitiated).async {
                completion(self.runCLI(cli, model: model, wav: wav))
            }
        case .python(let bin):
            DispatchQueue.global(qos: .userInitiated).async {
                completion(self.runPython(bin, wav: wav))
            }
        }
    }

    private func postOpenAI(url: URL, key: String, model: String, wav: Data, completion: @escaping (Result<String, Error>) -> Void) {
        let boundary = "DSH-\(UUID().uuidString)"
        var body = Data()
        body.appendMultipart(boundary: boundary, name: "model", value: model)
        body.appendMultipart(boundary: boundary, name: "response_format", value: "json")
        body.appendMultipart(boundary: boundary, name: "temperature", value: "0")
        body.appendMultipart(boundary: boundary, name: "prompt", value: "简体中文或英语听写。")
        body.appendMultipartFile(boundary: boundary, name: "file", filename: "speech.wav", mime: "audio/wav", data: wav)
        body.appendMultipartEnd(boundary: boundary)

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 45
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        request.httpBody = body

        URLSession.shared.dataTask(with: request) { data, response, error in
            completion(Self.decodeText(data: data, response: response, error: error))
        }.resume()
    }

    private func postLocal(base: URL, wav: Data, completion: @escaping (Result<String, Error>) -> Void) {
        // The in-process multipart POST came back 400 Invalid request from
        // this whisper-server build. curl's -F encoding is what the binary
        // accepts — same path we already verified with jfk.wav.
        DispatchQueue.global(qos: .userInitiated).async {
            completion(self.postLocalWithCurl(base: base, wav: wav))
        }
    }

    private func postLocalWithCurl(base: URL, wav: Data) -> Result<String, Error> {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-whisper-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let wavURL = tmp.appendingPathComponent("speech.wav")
        do { try wav.write(to: wavURL) } catch {
            return .failure(WhisperError.transcribe("无法写入录音"))
        }
        let endpoint = base.appendingPathComponent("inference").absoluteString
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        proc.arguments = [
            "-sS", "--max-time", "45",
            "-X", "POST", endpoint,
            "-F", "file=@\(wavURL.path);type=audio/wav",
            "-F", "temperature=0.0",
            "-F", "response_format=json",
            "-F", "language=auto",
        ]
        let out = Pipe()
        proc.standardOutput = out
        proc.standardError = FileHandle.nullDevice
        do { try proc.run() } catch {
            return .failure(WhisperError.transcribe(error.localizedDescription))
        }
        proc.waitUntilExit()
        let data = out.fileHandleForReading.readDataToEndOfFile()
        if proc.terminationStatus != 0 {
            return .failure(WhisperError.transcribe("Whisper 请求失败"))
        }
        return Self.decodeText(data: data, response: nil, error: nil)
    }

    private static func decodeText(data: Data?, response: URLResponse?, error: Error?) -> Result<String, Error> {
        if let error { return .failure(WhisperError.transcribe(error.localizedDescription)) }
        guard let data else { return .failure(WhisperError.transcribe("Whisper 没有返回结果")) }
        if let http = response as? HTTPURLResponse, !(200 ..< 300).contains(http.statusCode) {
            let detail = String(data: data, encoding: .utf8) ?? ""
            return .failure(WhisperError.transcribe("Whisper 请求失败（\(http.statusCode)）\(detail.prefix(160))"))
        }
        if let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let err = parsed["error"] as? String, !err.isEmpty {
                return .failure(WhisperError.transcribe(err))
            }
            if let text = parsed["text"] as? String {
                return .success(text)
            }
        }
        if let text = String(data: data, encoding: .utf8), !text.isEmpty {
            return .success(text)
        }
        return .failure(WhisperError.transcribe("无法解析 Whisper 结果"))
    }

    private func runCLI(_ cli: URL, model: URL, wav: Data) -> Result<String, Error> {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-whisper-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let wavURL = tmp.appendingPathComponent("speech.wav")
        let outPrefix = tmp.appendingPathComponent("out")
        do { try wav.write(to: wavURL) } catch {
            return .failure(WhisperError.transcribe("无法写入录音"))
        }
        let proc = Process()
        proc.executableURL = cli
        proc.arguments = [
            "-m", model.path,
            "-f", wavURL.path,
            "-l", "auto",
            "-nth", "0.75",
            "-nt",
            "-np",
            "-sns",
            "-otxt",
            "-of", outPrefix.path,
        ]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = Shell.launchPATH()
        proc.environment = env
        Self.attachLog(proc, name: "whisper-cli.log")
        do { try proc.run() } catch {
            return .failure(WhisperError.transcribe(error.localizedDescription))
        }
        proc.waitUntilExit()
        let txt = URL(fileURLWithPath: outPrefix.path + ".txt")
        if let text = try? String(contentsOf: txt, encoding: .utf8) {
            return .success(text)
        }
        return .failure(WhisperError.transcribe("whisper-cli 没有写出结果"))
    }

    private func runPython(_ bin: URL, wav: Data) -> Result<String, Error> {
        let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("dsh-whisper-py-\(UUID().uuidString)")
        try? FileManager.default.createDirectory(at: tmp, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: tmp) }
        let wavURL = tmp.appendingPathComponent("speech.wav")
        do { try wav.write(to: wavURL) } catch {
            return .failure(WhisperError.transcribe("无法写入录音"))
        }
        let proc = Process()
        proc.executableURL = bin
        proc.arguments = [
            wavURL.path,
            "--model", "small",
            "--output_format", "txt",
            "--output_dir", tmp.path,
            "--verbose", "False",
        ]
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = Shell.launchPATH()
        proc.environment = env
        Self.attachLog(proc, name: "whisper-python.log")
        do { try proc.run() } catch {
            return .failure(WhisperError.transcribe(error.localizedDescription))
        }
        proc.waitUntilExit()
        let txt = tmp.appendingPathComponent("speech.txt")
        if let text = try? String(contentsOf: txt, encoding: .utf8) {
            return .success(text)
        }
        return .failure(WhisperError.transcribe("Python whisper 没有写出结果"))
    }

    private static func which(_ name: String, path: String) -> URL? {
        let extras = [
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/Library/Frameworks/Python.framework/Versions/3.14/bin",
            NSHomeDirectory() + "/.local/bin",
        ]
        var dirs = extras
        dirs.append(contentsOf: path.split(separator: ":").map(String.init))
        var seen = Set<String>()
        for dir in dirs where seen.insert(dir).inserted {
            let url = URL(fileURLWithPath: dir).appendingPathComponent(name)
            if FileManager.default.isExecutableFile(atPath: url.path) { return url }
        }
        return nil
    }

    private static func attachLog(_ process: Process, name: String) {
        let url = ServerRecord.directory.appendingPathComponent(name)
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: Data())
        }
        if let handle = try? FileHandle(forWritingTo: url) {
            _ = try? handle.seekToEnd()
            process.standardOutput = handle
            process.standardError = handle
        } else {
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
        }
    }

    private static func freePort(_ port: Int) {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/sbin/lsof")
        proc.arguments = ["-nP", "-ti", "tcp:\(port)"]
        let out = Pipe()
        proc.standardOutput = out
        proc.standardError = FileHandle.nullDevice
        do { try proc.run() } catch { return }
        proc.waitUntilExit()
        let raw = String(data: out.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
        for line in raw.split(whereSeparator: \.isNewline) {
            guard let pid = Int32(line.trimmingCharacters(in: .whitespaces)), pid > 1 else { continue }
            kill(pid, SIGTERM)
        }
        Thread.sleep(forTimeInterval: 0.15)
    }
}

enum VoiceLog {
    static func line(_ message: String) {
        let url = ServerRecord.directory.appendingPathComponent("voice.log")
        let row = "[\(ISO8601DateFormatter().string(from: Date()))] \(message)\n"
        guard let data = row.data(using: .utf8) else { return }
        if !FileManager.default.fileExists(atPath: url.path) {
            FileManager.default.createFile(atPath: url.path, contents: data)
            return
        }
        guard let handle = try? FileHandle(forWritingTo: url) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
    }
}

// MARK: - WAV

enum WaveFile {
    static func encode(_ samples: [Int16], sampleRate: Int = 16_000) -> Data {
        let dataSize = samples.count * MemoryLayout<Int16>.size
        var data = Data()
        data.reserveCapacity(44 + dataSize)
        data.appendASCII("RIFF")
        data.appendLE(UInt32(36 + dataSize))
        data.appendASCII("WAVE")
        data.appendASCII("fmt ")
        data.appendLE(UInt32(16))
        data.appendLE(UInt16(1))
        data.appendLE(UInt16(1))
        data.appendLE(UInt32(sampleRate))
        data.appendLE(UInt32(sampleRate * 2))
        data.appendLE(UInt16(2))
        data.appendLE(UInt16(16))
        data.appendASCII("data")
        data.appendLE(UInt32(dataSize))
        samples.withUnsafeBytes { data.append(contentsOf: $0) }
        return data
    }
}

// MARK: - multipart / bytes

private extension Data {
    mutating func appendASCII(_ string: String) {
        append(contentsOf: string.utf8)
    }

    mutating func appendLE<T: FixedWidthInteger>(_ value: T) {
        var next = value.littleEndian
        Swift.withUnsafeBytes(of: &next) { append(contentsOf: $0) }
    }

    mutating func appendMultipart(boundary: String, name: String, value: String) {
        appendASCII("--\(boundary)\r\n")
        appendASCII("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        appendASCII("\(value)\r\n")
    }

    mutating func appendMultipartFile(boundary: String, name: String, filename: String, mime: String, data: Data) {
        appendASCII("--\(boundary)\r\n")
        appendASCII("Content-Disposition: form-data; name=\"\(name)\"; filename=\"\(filename)\"\r\n")
        appendASCII("Content-Type: \(mime)\r\n\r\n")
        append(data)
        appendASCII("\r\n")
    }

    mutating func appendMultipartEnd(boundary: String) {
        appendASCII("--\(boundary)--\r\n")
    }
}

// MARK: - download

private final class FileDownloader: NSObject, URLSessionDownloadDelegate {
    private let dest: URL
    private let progress: (String) -> Void
    private let completion: (Result<Void, Error>) -> Void
    private var session: URLSession!
    private var remaining: [URL]
    private var settled = false
    private var savedOK = false

    static func fetch(urls: [URL], to dest: URL, progress: @escaping (String) -> Void, completion: @escaping (Result<Void, Error>) -> Void) {
        let downloader = FileDownloader(urls: urls, dest: dest, progress: progress, completion: completion)
        downloader.start()
        objc_setAssociatedObject(downloader.session as Any, &FileDownloader.anchor, downloader, .OBJC_ASSOCIATION_RETAIN)
    }

    private static var anchor: UInt8 = 0

    private init(urls: [URL], dest: URL, progress: @escaping (String) -> Void, completion: @escaping (Result<Void, Error>) -> Void) {
        self.dest = dest
        self.progress = progress
        self.completion = completion
        self.remaining = urls
        super.init()
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 45
        config.timeoutIntervalForResource = 60 * 20
        session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }

    private func start() {
        guard !settled else { return }
        guard let url = remaining.first else {
            finish(.failure(WhisperError.download(
                "无法下载 Whisper 模型。请检查网络，或把 ggml-small.bin 放到 \(dest.path)"
            )))
            return
        }
        remaining.removeFirst()
        savedOK = false
        progress("正在下载 Whisper 模型…")
        session.downloadTask(with: url).resume()
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        guard totalBytesExpectedToWrite > 0 else { return }
        let pct = Int((Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)) * 100)
        let mb = Double(totalBytesWritten) / 1_000_000
        let total = Double(totalBytesExpectedToWrite) / 1_000_000
        progress(String(format: "正在下载 Whisper 模型… %d%%（%.0f / %.0f MB）", pct, mb, total))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let status = (downloadTask.response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else { return }
        do {
            if FileManager.default.fileExists(atPath: dest.path) {
                try FileManager.default.removeItem(at: dest)
            }
            try FileManager.default.copyItem(at: location, to: dest)
            savedOK = true
        } catch {
            savedOK = false
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if settled { return }
        if error == nil, savedOK {
            finish(.success(()))
            return
        }
        start()
    }

    private func finish(_ result: Result<Void, Error>) {
        guard !settled else { return }
        settled = true
        session.finishTasksAndInvalidate()
        DispatchQueue.global(qos: .userInitiated).async { self.completion(result) }
    }
}
