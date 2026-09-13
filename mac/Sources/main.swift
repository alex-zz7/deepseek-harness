// DeepSeek Harness — native macOS shell
//
// A thin native wrapper around the DSH browser UI (`dsh web`).
//
// Responsibilities:
//   1. Locate the `dsh` executable.
//   2. **Attach** to a DSH web server that is already running, if one is.
//      Otherwise spawn `dsh web --no-open --port 0` (OS picks a free port).
//   3. Parse the one startup line — `dsh web: http://127.0.0.1:PORT/?token=...` —
//      which carries the auth token the browser-trust fence requires.
//   4. Load that URL in a WKWebView inside a real NSWindow.
//   5. Leave the server running on quit so the next launch — and any
//      browser tab already on that URL — keeps working.
//   6. Install a login LaunchAgent that pre-warms `dsh web` after reboot.
//
// Why attaching matters
// ---------------------
// A session can be written by only one server at a time: the owner holds a
// kernel `flock(2)` lease on the session's `session.lock`, and a second server
// resuming that session gets `SessionAlreadyOwnedError`. A server can serve
// many clients, though — so the way to let the app and browser tabs coexist is
// for them to share ONE server rather than each owning one.
//
// A token cannot be recovered from a server we did not spawn: it is
// `randomBytes(32)` held only in that process's memory and printed once at
// startup. So the server's launch URL is *published* to `~/.dsh/web-url` — by
// this app when it spawns, and by `mac/open-in-browser.sh` when it does — and
// either side can pick it up. Whoever finds a live published URL attaches
// instead of spawning.
//
// Usage: DeepSeekHarness [--make-icon <out.png> [logo.svg]]

import AppKit
import Darwin
import Network
import WebKit

/// Prime Desktop / Documents / Downloads in one sitting.
///
/// macOS will not merge those into a single dialog. Touching each folder
/// here, with the matching usage strings in Info.plist, is what makes the
/// grant persist so later launches (and vaults on the Desktop) stay quiet.
enum FolderAccess {
    static func requestKnownFolders() {
        DispatchQueue.global(qos: .utility).async {
            let home = FileManager.default.homeDirectoryForCurrentUser
            for name in ["Desktop", "Documents", "Downloads"] {
                let url = home.appendingPathComponent(name, isDirectory: true)
                _ = try? url.checkResourceIsReachable()
            }
        }
    }
}

// MARK: - Icon generation (reuses this binary; keeps the build dependency-free)

func makeIcon(at path: String, logoPath: String?) {
    let size = 1024
    guard
        let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size,
            bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
            colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
        let ctx = NSGraphicsContext(bitmapImageRep: rep)
    else {
        FileHandle.standardError.write(Data("icon: could not allocate bitmap\n".utf8))
        exit(1)
    }

    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = ctx

    let full = NSRect(x: 0, y: 0, width: size, height: size)
    let inset = CGFloat(size) * 0.055
    let body = full.insetBy(dx: inset, dy: inset)
    let radius = CGFloat(size) * 0.225
    let shape = NSBezierPath(roundedRect: body, xRadius: radius, yRadius: radius)

    // DeepSeek's mark is a black whale drawn for a light surface, so the tile
    // is that surface and the glyph keeps its own fill.
    NSColor.white.setFill()
    shape.fill()

    // A hairline keeps a white tile from dissolving into a light background.
    NSColor(calibratedWhite: 0, alpha: 0.10).setStroke()
    shape.lineWidth = CGFloat(size) * 0.004
    shape.stroke()

    let logo = logoPath.flatMap { NSImage(contentsOfFile: $0) }
    if let logo {
        // The artwork carries its own margins, so it sits larger than a glyph
        // that had to be inset by hand.
        let side = body.width * 0.78
        let target = NSRect(
            x: body.midX - side / 2,
            y: body.midY - side / 2,
            width: side,
            height: side)
        logo.draw(in: target, from: .zero, operation: .sourceOver, fraction: 1)
    } else {
        // No artwork beside the binary: fall back to a wordmark rather than
        // shipping a blank tile.
        let text = "DS" as NSString
        let font = NSFont.systemFont(ofSize: CGFloat(size) * 0.35, weight: .bold)
        let attrs: [NSAttributedString.Key: Any] = [
            .font: font,
            .foregroundColor: NSColor.black,
        ]
        let textSize = text.size(withAttributes: attrs)
        text.draw(
            at: NSPoint(x: body.midX - textSize.width / 2, y: body.midY - textSize.height / 2),
            withAttributes: attrs)
    }

    NSGraphicsContext.restoreGraphicsState()

    guard let png = rep.representation(using: .png, properties: [:]) else {
        FileHandle.standardError.write(Data("icon: PNG encode failed\n".utf8))
        exit(1)
    }
    do {
        try png.write(to: URL(fileURLWithPath: path))
    } catch {
        FileHandle.standardError.write(Data("icon: \(error.localizedDescription)\n".utf8))
        exit(1)
    }
}

// MARK: - Locating the dsh executable

enum Locator {
    private static let cacheKey = "dsh-bin"

    private static func remember(_ path: String) -> URL {
        UserDefaults.standard.set(path, forKey: cacheKey)
        let dest = ServerRecord.directory.appendingPathComponent("dsh-path")
        try? path.write(to: dest, atomically: true, encoding: .utf8)
        return URL(fileURLWithPath: path)
    }

    static func dsh() -> URL? {
        let fm = FileManager.default
        let env = ProcessInfo.processInfo.environment

        if let explicit = env["DSH_BIN"], fm.isExecutableFile(atPath: explicit) {
            return remember(explicit)
        }
        if let cached = UserDefaults.standard.string(forKey: cacheKey),
           fm.isExecutableFile(atPath: cached) {
            return remember(cached)
        }

        // Newest npx cache entry wins — that is where `npx @deepseek-ai/dsh` lands.
        let npxRoot = URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".npm/_npx")
        if let entries = try? fm.contentsOfDirectory(
            at: npxRoot, includingPropertiesForKeys: [.contentModificationDateKey],
            options: [.skipsHiddenFiles])
        {
            let newestFirst = entries.sorted { lhs, rhs in
                let l = (try? lhs.resourceValues(forKeys: [.contentModificationDateKey])
                    .contentModificationDate) ?? .distantPast
                let r = (try? rhs.resourceValues(forKeys: [.contentModificationDateKey])
                    .contentModificationDate) ?? .distantPast
                return l > r
            }
            for dir in newestFirst {
                let candidate = dir.appendingPathComponent("node_modules/.bin/dsh")
                if fm.isExecutableFile(atPath: candidate.path) {
                    return remember(candidate.path)
                }
            }
        }

        let common = [
            "/opt/homebrew/bin/dsh",
            "/usr/local/bin/dsh",
            NSHomeDirectory() + "/.local/bin/dsh",
        ]
        for path in common where fm.isExecutableFile(atPath: path) {
            return remember(path)
        }

        // Last resort: ask a login shell, which sees the user's real PATH.
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: "/bin/zsh")
        probe.arguments = ["-lc", "command -v dsh"]
        let out = Pipe()
        probe.standardOutput = out
        probe.standardError = Pipe()
        do {
            try probe.run()
            probe.waitUntilExit()
        } catch {
            return nil
        }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        guard
            let raw = String(data: data, encoding: .utf8)?
                .trimmingCharacters(in: .whitespacesAndNewlines),
            !raw.isEmpty, fm.isExecutableFile(atPath: raw)
        else { return nil }
        return remember(raw)
    }
}

// MARK: - Shell environment

enum Shell {
    /// macOS launches GUI apps from launchd with a minimal PATH. `dsh` is a
    /// `#!/usr/bin/env node` script, so a minimal PATH makes it die instantly
    /// with `env: node: No such file or directory` (exit 127). Always hand the
    /// child the PATH a login shell would see.
    static let fallbackPATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

    private static let cacheKey = "dsh-login-path"
    private static var cached: String?

    /// PATH for spawning `dsh`. Never blocks on a login shell — that can take
    /// seconds when ~/.zshrc is heavy, and it sat on the launch path.
    static func launchPATH() -> String {
        if let cached { return cached }
        if let stored = UserDefaults.standard.string(forKey: cacheKey), !stored.isEmpty {
            cached = stored
            refreshInBackground()
            return stored
        }
        refreshInBackground()
        return fallbackPATH
    }

    private static func refreshInBackground() {
        DispatchQueue.global(qos: .utility).async {
            let probe = Process()
            probe.executableURL = URL(fileURLWithPath: "/bin/zsh")
            probe.arguments = ["-lc", "printf %s \"$PATH\""]
            let out = Pipe()
            probe.standardOutput = out
            probe.standardError = Pipe()
            guard (try? probe.run()) != nil else { return }
            let data = out.fileHandleForReading.readDataToEndOfFile()
            probe.waitUntilExit()
            guard let text = String(data: data, encoding: .utf8), !text.isEmpty else { return }
            cached = text
            UserDefaults.standard.set(text, forKey: cacheKey)
        }
    }
}

// MARK: - Shared launch URL

/// The one place a running server's token-bearing URL is published, so the app,
/// the shell script, and any future client can share a single server instead of
/// fighting over session locks.
enum WebURL {
    static var file: URL {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".dsh/web-url")
    }

    /// The tokenized loopback URL, or nil when nothing valid is published.
    static func read() -> URL? {
        guard
            let text = try? String(contentsOf: file, encoding: .utf8),
            let line = text.split(whereSeparator: \.isNewline).first
        else { return nil }

        let raw = line.trimmingCharacters(in: .whitespaces)
        guard !raw.isEmpty else { return nil }

        // Same shape the startup banner uses; anything else is not ours.
        let pattern = #"^http://127\.0\.0\.1:(\d+)/\?token=[A-Za-z0-9._~-]+$"#
        guard
            let regex = try? NSRegularExpression(pattern: pattern),
            let match = regex.firstMatch(
                in: raw, options: [], range: NSRange(raw.startIndex..<raw.endIndex, in: raw)),
            let range = Range(match.range, in: raw),
            let url = URL(string: String(raw[range])),
            url.port != nil
        else { return nil }
        return url
    }

    /// Publish a URL for other clients, best effort.
    static func publish(_ url: URL) {
        try? FileManager.default.createDirectory(
            at: file.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? (url.absoluteString + "\n").write(to: file, atomically: true, encoding: .utf8)
    }

    /// Retract the published URL, but only while it still names `url` — a
    /// server we do not own must never have its published URL removed by us.
    static func retract(_ url: URL) {
        guard let current = try? String(contentsOf: file, encoding: .utf8) else { return }
        guard current.trimmingCharacters(in: .whitespacesAndNewlines) == url.absoluteString
        else { return }
        try? FileManager.default.removeItem(at: file)
    }

    /// A bare TCP connect to the URL's port. Synchronous on purpose: the caller
    /// is already on a background queue, and this is the only liveness signal
    /// that needs no HTTP semantics. Following the real URL would consume the
    /// single-use token, so we must not.
    static func probe(_ url: URL) -> Bool {
        guard let port = url.port, let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
            return false
        }
        let queue = DispatchQueue(label: "dsh.weburl.probe")
        let connection = NWConnection(host: "127.0.0.1", port: nwPort, using: .tcp)
        let done = DispatchSemaphore(value: 0)
        var reachable = false

        connection.stateUpdateHandler = { state in
            switch state {
            case .ready:
                reachable = true
                done.signal()
            case .failed, .cancelled:
                done.signal()
            default:
                // `.waiting` is the first state even for a live localhost
                // port. Treating it as a miss made every launch spawn a new
                // `dsh web` and kill the leftover.
                break
            }
        }
        connection.start(queue: queue)

        if done.wait(timeout: .now() + 0.6) == .timedOut {
            connection.cancel()
            return false
        }
        connection.cancel()
        return reachable
    }
}

/// Serializes "start a server" so the app and the login keeper never spawn two.
/// `mkdir` is the lock: macOS has no `flock` command, and this matches keep-dsh.sh.
enum WebLock {
    static var dir: URL {
        URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent(".dsh/web.lockdir")
    }

    static func acquire(timeout: TimeInterval = 60) -> Bool {
        try? FileManager.default.createDirectory(
            at: dir.deletingLastPathComponent(), withIntermediateDirectories: true)
        let path = dir.path
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if mkdir(path, 0o755) == 0 { return true }
            usleep(100_000)
        }
        return false
    }

    static func release() {
        rmdir(dir.path)
    }
}

// MARK: - Process tree teardown

enum ProcessTree {
    /// Direct children of `pid`, via pgrep (no shell quoting hazards).
    private static func children(of pid: pid_t) -> [pid_t] {
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        probe.arguments = ["-P", String(pid)]
        let out = Pipe()
        probe.standardOutput = out
        probe.standardError = Pipe()
        do { try probe.run() } catch { return [] }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        probe.waitUntilExit()
        guard let text = String(data: data, encoding: .utf8) else { return [] }
        return text.split(whereSeparator: \.isNewline).compactMap {
            Int32($0.trimmingCharacters(in: .whitespaces))
        }
    }

    /// `dsh web` spawns helpers (MCP servers, pnpm). Killing only the direct
    /// child would leave those behind, so walk the whole subtree.
    static func terminate(root: pid_t) {
        var descendants: [pid_t] = []
        var queue: [pid_t] = [root]
        while let next = queue.popLast() {
            let kids = children(of: next)
            descendants.append(contentsOf: kids)
            queue.append(contentsOf: kids)
        }

        // Deepest first, then the root.
        let targets = descendants.reversed() + [root]
        for pid in targets { kill(pid, SIGTERM) }

        let deadline = Date().addingTimeInterval(3)
        while Date() < deadline {
            if targets.allSatisfy({ kill($0, 0) != 0 }) { return }
            usleep(80_000)
        }
        for pid in targets where kill(pid, 0) == 0 { kill(pid, SIGKILL) }
    }

    /// Command line for a PID, used to avoid killing an unrelated process that
    /// happened to inherit a recycled PID.
    static func commandLine(of pid: pid_t) -> String? {
        let probe = Process()
        probe.executableURL = URL(fileURLWithPath: "/bin/ps")
        probe.arguments = ["-o", "command=", "-p", String(pid)]
        let out = Pipe()
        probe.standardOutput = out
        probe.standardError = Pipe()
        do { try probe.run() } catch { return nil }
        let data = out.fileHandleForReading.readDataToEndOfFile()
        probe.waitUntilExit()
        return String(data: data, encoding: .utf8)
    }
}

// MARK: - Server record

/// Remembers the spawned server so a crash or force-quit cannot strand it.
enum ServerRecord {
    static var directory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory() + "/Library/Application Support")
        let dir = base.appendingPathComponent("DeepSeekHarness", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static var pidFile: URL { directory.appendingPathComponent("server.pid") }

    static func write(_ pid: pid_t) {
        try? String(pid).write(to: pidFile, atomically: true, encoding: .utf8)
    }

    static func clear() {
        try? FileManager.default.removeItem(at: pidFile)
    }

    /// Reaps a server left behind by a previous run that died without cleanup.
    static func sweepStale() {
        guard
            let raw = try? String(contentsOf: pidFile, encoding: .utf8),
            let pid = Int32(raw.trimmingCharacters(in: .whitespacesAndNewlines))
        else { return }
        clear()

        guard pid > 1, kill(pid, 0) == 0 else { return }
        // Guard against PID reuse: only reap something that really is our server.
        guard let cmd = ProcessTree.commandLine(of: pid),
              cmd.contains("dsh"), cmd.contains("web")
        else { return }
        ProcessTree.terminate(root: pid)
    }
}

/// Starts `dsh web` at login so the first click after reboot can attach.
enum KeepAliveAgent {
    static let label = "local.deepseek-harness.dsh"

    static var script: URL { ServerRecord.directory.appendingPathComponent("keep-dsh.sh") }

    static var plist: URL {
        URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library/LaunchAgents/\(label).plist")
    }

    static var compileCache: URL {
        ServerRecord.directory.appendingPathComponent("node-compile-cache", isDirectory: true)
    }

    static func install() {
        let fm = FileManager.default
        try? fm.createDirectory(at: ServerRecord.directory, withIntermediateDirectories: true)
        try? fm.createDirectory(at: compileCache, withIntermediateDirectories: true)

        let bundled = Bundle.main.url(forResource: "keep-dsh", withExtension: "sh")
            ?? Bundle.main.resourceURL?.appendingPathComponent("keep-dsh.sh")
        if let bundled, fm.fileExists(atPath: bundled.path) {
            try? fm.removeItem(at: script)
            try? fm.copyItem(at: bundled, to: script)
            try? fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: script.path)
        }
        guard fm.isExecutableFile(atPath: script.path) else { return }

        let home = NSHomeDirectory()
        let uid = getuid()
        let body = """
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0">
            <dict>
                <key>Label</key>
                <string>\(label)</string>
                <key>ProgramArguments</key>
                <array>
                    <string>\(xmlEscape(script.path))</string>
                </array>
                <key>RunAtLoad</key>
                <true/>
                <key>KeepAlive</key>
                <true/>
                <key>WorkingDirectory</key>
                <string>\(xmlEscape(home))</string>
                <key>EnvironmentVariables</key>
                <dict>
                    <key>HOME</key>
                    <string>\(xmlEscape(home))</string>
                    <key>PATH</key>
                    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
                    <key>NODE_COMPILE_CACHE</key>
                    <string>\(xmlEscape(compileCache.path))</string>
                </dict>
                <key>StandardOutPath</key>
                <string>\(xmlEscape(ServerRecord.directory.appendingPathComponent("keep-dsh.out.log").path))</string>
                <key>StandardErrorPath</key>
                <string>\(xmlEscape(ServerRecord.directory.appendingPathComponent("keep-dsh.err.log").path))</string>
            </dict>
            </plist>
            """
        try? FileManager.default.createDirectory(
            at: plist.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? body.write(to: plist, atomically: true, encoding: .utf8)

        let target = "gui/\(uid)/\(label)"
        if launchctl(["print", target]) == 0 {
            if !isScriptRunning() {
                _ = launchctl(["bootout", target])
                _ = launchctl(["bootstrap", "gui/\(uid)", plist.path])
            }
            return
        }
        _ = launchctl(["bootstrap", "gui/\(uid)", plist.path])
    }

    private static func isScriptRunning() -> Bool {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        proc.arguments = ["-f", "keep-dsh.sh"]
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        guard (try? proc.run()) != nil else { return false }
        proc.waitUntilExit()
        return proc.terminationStatus == 0
    }

    private static func xmlEscape(_ text: String) -> String {
        text
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
    }

    private static func launchctl(_ arguments: [String]) -> Int32 {
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        proc.arguments = arguments
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        guard (try? proc.run()) != nil else { return 1 }
        proc.waitUntilExit()
        return proc.terminationStatus
    }
}

// MARK: - Server lifecycle

final class ServerController {
    enum State {
        case idle
        case starting
        /// Serving from a server we spawned; `owned` is false when we attached
        /// to one another client published.
        case ready(URL, owned: Bool)
        case failed(String)
    }

    private(set) var state: State = .idle {
        didSet { onStateChange?(state) }
    }

    var onStateChange: ((State) -> Void)?

    private var process: Process?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var pending = ""
    private var logTail = ""
    private var timeoutWork: DispatchWorkItem?
    private var stopping = false
    /// True only while `process` is a server this app launched. An attached
    /// server is borrowed: quitting must not take it down.
    private var spawnedByUs = false
    /// The URL of a live server found in the shared record. Used to retract
    /// that record when we stop owning the server that published it.
    private var sharedURL: URL?
    private var holdingLock = false

    private func releaseSpawnLock() {
        guard holdingLock else { return }
        WebLock.release()
        holdingLock = false
    }

    /// The token-bearing URL the fence accepts.
    private static let urlRegex = try! NSRegularExpression(
        pattern: #"http://127\.0\.0\.1:\d+/\?token=[A-Za-z0-9._~-]+"#)

    func start() {
        guard case .idle = state else { return }

        // Attach first, spawn only as a fallback. A server serves many clients,
        // so sharing one is what keeps the app and browser tabs from holding
        // competing write leases on the same sessions.
        state = .starting
        let queue = DispatchQueue(label: "dsh.server.start", qos: .userInitiated)
        queue.async { [weak self] in
            guard let self else { return }

            if let url = WebURL.read(), WebURL.probe(url) {
                DispatchQueue.main.async {
                    guard !self.stopping else { return }
                    self.sharedURL = url
                    self.spawnedByUs = false
                    self.state = .ready(url, owned: false)
                }
                return
            }

            let locked = WebLock.acquire()
            if let url = WebURL.read(), WebURL.probe(url) {
                if locked { WebLock.release() }
                DispatchQueue.main.async {
                    guard !self.stopping else { return }
                    self.sharedURL = url
                    self.spawnedByUs = false
                    self.state = .ready(url, owned: false)
                }
                return
            }

            // A published URL that does not answer is a dead token; retract it
            // so the next client does not wait on it.
            if let stale = WebURL.read() { WebURL.retract(stale) }

            // Nothing live to attach to, so the published token is dead.
            let dsh = Locator.dsh()
            DispatchQueue.main.async {
                guard !self.stopping else {
                    if locked { WebLock.release() }
                    return
                }
                guard let dsh else {
                    if locked { WebLock.release() }
                    self.state = .failed(
                        "找不到 dsh 可执行文件。\n\n请先安装：npx @deepseek-ai/dsh\n"
                        + "或设置环境变量 DSH_BIN 指向 dsh。")
                    return
                }
                self.holdingLock = locked
                self.spawn(dsh)
            }
        }
    }

    /// Launches the app's own server. Runs on the main queue.
    private func spawn(_ dsh: URL) {
        // Reap a server orphaned by a previous crash before claiming the slot.
        // Only ever our own record: an attached server was never ours to reap.
        ServerRecord.sweepStale()

        let proc = Process()
        proc.executableURL = dsh
        proc.arguments = ["web", "--no-open", "--port", "0"]
        // Launch Services starts GUI apps with cwd `/`, which would make `/` the
        // agent's workspace root. Home is the least surprising default.
        proc.currentDirectoryURL = URL(fileURLWithPath: NSHomeDirectory())

        // The PATH fix: without this the child dies instantly under `open`.
        var environment = ProcessInfo.processInfo.environment
        let dshDir = dsh.deletingLastPathComponent().path
        environment["PATH"] = [
            dshDir,
            Shell.launchPATH(),
            Shell.fallbackPATH,
        ].joined(separator: ":")
        try? FileManager.default.createDirectory(
            at: KeepAliveAgent.compileCache, withIntermediateDirectories: true)
        environment["NODE_COMPILE_CACHE"] = KeepAliveAgent.compileCache.path
        proc.environment = environment

        let out = Pipe()
        let err = Pipe()
        proc.standardOutput = out
        proc.standardError = err
        proc.standardInput = FileHandle.nullDevice

        out.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            self?.consume(data)
        }
        err.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            self?.consume(data)
        }

        proc.terminationHandler = { [weak self] finished in
            DispatchQueue.main.async {
                guard let self else { return }
                self.clearHandlers()
                self.releaseSpawnLock()
                ServerRecord.clear()
                if self.stopping { return }
                switch self.state {
                case .ready:
                    self.state = .failed(
                        "DSH 服务已退出（状态码 \(finished.terminationStatus)）。\n\n"
                        + self.tail())
                default:
                    self.state = .failed(
                        "DSH 服务启动失败（状态码 \(finished.terminationStatus)）。\n\n"
                        + self.tail())
                }
            }
        }

        do {
            try proc.run()
        } catch {
            releaseSpawnLock()
            state = .failed("无法启动 dsh：\(error.localizedDescription)")
            return
        }

        process = proc
        stdoutPipe = out
        stderrPipe = err
        ServerRecord.write(proc.processIdentifier)

        // If the startup banner never arrives, stop waiting and say why.
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, !self.stopping, case .starting = self.state else { return }
            self.releaseSpawnLock()
            self.state = .failed("等待 DSH 服务启动超时（60 秒）。\n\n" + self.tail())
        }
        timeoutWork = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: timeout)
    }

    /// Accumulates output and scans complete lines for the startup banner.
    private func consume(_ data: Data) {
        guard let chunk = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.pending += chunk
            while let newline = self.pending.firstIndex(of: "\n") {
                let line = String(self.pending[self.pending.startIndex..<newline])
                self.pending.removeSubrange(self.pending.startIndex...newline)
                self.handle(line: line)
            }
        }
    }

    private func handle(line: String) {
        appendLog(line)
        guard case .starting = state else { return }

        let range = NSRange(line.startIndex..<line.endIndex, in: line)
        guard
            let match = Self.urlRegex.firstMatch(in: line, options: [], range: range),
            let matchRange = Range(match.range, in: line),
            let url = URL(string: String(line[matchRange]))
        else { return }

        timeoutWork?.cancel()
        timeoutWork = nil
        spawnedByUs = true
        // Publish so a browser tab (or a later launch) can share this server
        // instead of starting a second one that would contend for session locks.
        WebURL.publish(url)
        sharedURL = url
        releaseSpawnLock()
        state = .ready(url, owned: true)
    }

    private func appendLog(_ line: String) {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        logTail += trimmed + "\n"
        if logTail.count > 4000 { logTail = String(logTail.suffix(3000)) }
    }

    private func tail() -> String {
        let t = logTail.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? "（服务没有输出任何日志）" : "最近输出：\n" + t
    }

    private func clearHandlers() {
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        stdoutPipe = nil
        stderrPipe = nil
    }

    /// Re-arms a failed controller and tries again from a clean slate.
    func retry() {
        guard case .failed = state else { return }
        stopping = false
        pending = ""
        logTail = ""
        state = .idle
        start()
    }

    /// Leave the process running so the next launch attaches in milliseconds
    /// instead of waiting for a cold `dsh web` boot.
    func handoff() {
        stopping = true
        timeoutWork?.cancel()
        timeoutWork = nil
        clearHandlers()
        releaseSpawnLock()
        process = nil
        spawnedByUs = false
    }

    /// Stops the server, but only if this app is what started it. An attached
    /// server belongs to whoever launched it; quitting must leave it running.
    func stop() {
        stopping = true
        timeoutWork?.cancel()
        timeoutWork = nil
        clearHandlers()
        releaseSpawnLock()

        guard spawnedByUs else {
            sharedURL = nil
            process = nil
            return
        }

        if let proc = process {
            let pid = proc.processIdentifier
            if proc.isRunning || kill(pid, 0) == 0 {
                ProcessTree.terminate(root: pid)
            }
            if proc.isRunning { proc.waitUntilExit() }  // reap the zombie
        }
        process = nil
        ServerRecord.clear()
        if let url = sharedURL { WebURL.retract(url) }
        sharedURL = nil
        spawnedByUs = false
    }
}

// MARK: - Web view host

/// Relays a page message to the app, weakly.
///
/// `WKUserContentController` retains its handlers, and the handler would retain
/// the view that owns the controller — so the view is held weakly here rather
/// than making `WebHostView` itself the handler and leaking every closed window.
final class ScriptMessageRelay: NSObject, WKScriptMessageHandler {
    weak var appDelegate: AppDelegate?

    func userContentController(
        _ userContentController: WKUserContentController,
        didReceive message: WKScriptMessage
    ) {
        switch message.name {
        case "dshOpenInBrowser":
            appDelegate?.openInBrowser(nil)
        case "dshVoiceToggle":
            appDelegate?.toggleVoice()
        case "dshVoiceFinish":
            appDelegate?.finishVoice()
        case "dshVoiceCancel":
            appDelegate?.cancelVoice()
        case "dshOpenProjects":
            appDelegate?.openProjects()
        case "dshPickWorkspace":
            appDelegate?.pickWorkspace(message.body as? String ?? "")
        case "dshPickMaterials":
            appDelegate?.pickMaterials()
        case "dshRevealInFinder":
            appDelegate?.revealInFinder(message.body as? String ?? "")
        default:
            break
        }
    }
}

final class WebHostView: NSView {
    let webView: WKWebView
    private let statusLabel = NSTextField(labelWithString: "正在启动 DeepSeek Harness…")
    private let detailLabel = NSTextField(wrappingLabelWithString: "")
    private let spinner = NSProgressIndicator()
    private let retryButton = NSButton(title: "重试", target: nil, action: nil)
    private let relay = ScriptMessageRelay()

    override init(frame frameRect: NSRect) {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore.nonPersistent()
        // Sidebar row affordances live only here. The browser loads the same
        // server and the same client bundle but never this script, which is
        // exactly what keeps the web surface unchanged.
        config.userContentController.addUserScript(
            WKUserScript(
                source: sidebarActionsScript,
                injectionTime: .atDocumentEnd,
                forMainFrameOnly: true))
        // Handlers must be registered before the web view is created.
        // Adding them afterwards can leave the content process on a blank page.
        for name in [
            "dshOpenInBrowser", "dshVoiceToggle", "dshVoiceFinish", "dshVoiceCancel",
            "dshOpenProjects", "dshPickWorkspace", "dshPickMaterials",
            "dshRevealInFinder",
        ] {
            config.userContentController.add(relay, name: name)
        }
        webView = WKWebView(frame: .zero, configuration: config)
        super.init(frame: frameRect)
        relay.appDelegate = NSApp.delegate as? AppDelegate
        build()
    }

    required init?(coder: NSCoder) { fatalError("not supported") }

    private func build() {
        webView.translatesAutoresizingMaskIntoConstraints = false
        addSubview(webView)

        spinner.translatesAutoresizingMaskIntoConstraints = false
        spinner.style = .spinning
        spinner.controlSize = .regular
        spinner.isDisplayedWhenStopped = false

        statusLabel.translatesAutoresizingMaskIntoConstraints = false
        statusLabel.font = .systemFont(ofSize: 15, weight: .semibold)
        statusLabel.alignment = .center

        detailLabel.translatesAutoresizingMaskIntoConstraints = false
        detailLabel.font = .monospacedSystemFont(ofSize: 11, weight: .regular)
        detailLabel.textColor = .secondaryLabelColor
        detailLabel.alignment = .center
        detailLabel.maximumNumberOfLines = 14
        detailLabel.preferredMaxLayoutWidth = 520

        retryButton.translatesAutoresizingMaskIntoConstraints = false
        retryButton.bezelStyle = .rounded
        retryButton.isHidden = true

        addSubview(spinner)
        addSubview(statusLabel)
        addSubview(detailLabel)
        addSubview(retryButton)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: topAnchor),
            webView.bottomAnchor.constraint(equalTo: bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: trailingAnchor),

            spinner.centerXAnchor.constraint(equalTo: centerXAnchor),
            spinner.bottomAnchor.constraint(equalTo: statusLabel.topAnchor, constant: -14),

            statusLabel.centerXAnchor.constraint(equalTo: centerXAnchor),
            statusLabel.centerYAnchor.constraint(equalTo: centerYAnchor, constant: -12),
            statusLabel.leadingAnchor.constraint(greaterThanOrEqualTo: leadingAnchor, constant: 40),

            detailLabel.topAnchor.constraint(equalTo: statusLabel.bottomAnchor, constant: 12),
            detailLabel.centerXAnchor.constraint(equalTo: centerXAnchor),
            detailLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 40),
            detailLabel.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -40),

            retryButton.topAnchor.constraint(equalTo: detailLabel.bottomAnchor, constant: 18),
            retryButton.centerXAnchor.constraint(equalTo: centerXAnchor),
        ])
    }

    /// Shows the boot overlay. The message distinguishes attaching to a server
    /// that is already running from starting a new one.
    func showLoading(_ message: String = "正在启动 DeepSeek Harness…") {
        statusLabel.isHidden = false
        detailLabel.isHidden = true
        spinner.isHidden = false
        spinner.startAnimation(nil)
        retryButton.isHidden = true
        statusLabel.stringValue = message
    }

    func showFailure(_ message: String, retry: Selector, target: AnyObject) {
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        statusLabel.isHidden = false
        statusLabel.stringValue = "无法启动"
        detailLabel.stringValue = message
        detailLabel.isHidden = false
        retryButton.target = target
        retryButton.action = retry
        retryButton.isHidden = false
    }

    func showWeb() {
        spinner.stopAnimation(nil)
        spinner.isHidden = true
        statusLabel.isHidden = true
        detailLabel.isHidden = true
        retryButton.isHidden = true
    }
}

// MARK: - Window controller

final class HarnessWindowController: NSWindowController, WKNavigationDelegate, WKUIDelegate {
    private let host: WebHostView

    init() {
        let frame = NSRect(x: 0, y: 0, width: 1180, height: 820)
        let window = NSWindow(
            contentRect: frame,
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false)
        window.title = "DeepSeek Harness"
        window.titlebarAppearsTransparent = false
        window.minSize = NSSize(width: 720, height: 480)
        window.center()
        window.setFrameAutosaveName("HarnessMainWindow")
        window.tabbingMode = .disallowed

        // A frame autosaved against a different display arrangement can restore
        // entirely off-screen, which yields a running app with an invisible
        // window and no way back. Fall back to centring when nothing on screen
        // overlaps it.
        let primary = NSScreen.main?.visibleFrame ?? .zero
        if !primary.intersects(window.frame) { window.center() }

        host = WebHostView(frame: frame)
        window.contentView = host

        super.init(window: window)

        host.webView.navigationDelegate = self
        host.webView.uiDelegate = self
        host.webView.allowsBackForwardNavigationGestures = true

        // The browser affordance itself lives in the page's brand row, next to
        // the wordmark, injected by `sidebarActionsScript`. A web page cannot
        // open the user's browser, so it asks the shell over this channel.
        //
        // No server juggling is involved: the launch token is NOT single-use.
        // `authorizeIndex` mints a fresh cookie for every request carrying the
        // right token, for the life of the process, so the URL this web view
        // already holds works in any browser. (The comment in
        // `open-in-browser.sh` claiming the token is consumed by following the
        // URL is wrong — measured: the same URL answers 303 repeatedly.)
    }

    required init?(coder: NSCoder) { fatalError("not supported") }

    func load(_ url: URL) {
        host.showWeb()
        host.webView.load(URLRequest(url: url))
    }

    func presentLoading() { host.showLoading() }

    /// Page zoom, clamped to a sane range.
    var pageZoom: CGFloat {
        get { host.webView.pageZoom }
        set { host.webView.pageZoom = min(2.5, max(0.5, newValue)) }
    }

    // MARK: dictation bridge

    /// Push a dictation transcript into the page. The composer lives in the page,
    /// so the page owns the text; the shell only reports what was heard.
    func pushVoice(_ text: String, isFinal: Bool) {
        evaluate("window.__dshVoiceText && window.__dshVoiceText(\(Self.jsString(text)), \(isFinal))")
    }

    /// Reflect the recorder's state on the page's mic button.
    func pushVoiceState(_ state: VoiceInput.State) {
        switch state {
        case .idle:
            evaluate("window.__dshVoiceState && window.__dshVoiceState('idle')")
        case .starting(let message):
            evaluate("window.__dshVoiceState && window.__dshVoiceState('starting', \(Self.jsString(message)))")
        case .listening:
            evaluate("window.__dshVoiceState && window.__dshVoiceState('listening')")
        case .cancelled:
            evaluate("window.__dshVoiceState && window.__dshVoiceState('cancelled')")
        case .failed(let message):
            evaluate("window.__dshVoiceState && window.__dshVoiceState('failed', \(Self.jsString(message)))")
        }
    }

    private func evaluate(_ script: String) {
        host.webView.evaluateJavaScript(script, completionHandler: nil)
    }

    /// Feed the page's level meter. Called ~30 times a second while listening,
    /// so it stays a single number and no JSON encoding.
    func pushVoiceLevel(_ level: Float) {
        let clamped = max(0, min(1, level))
        evaluate("window.__dshVoiceLevel && window.__dshVoiceLevel(\(String(format: "%.3f", clamped)))")
    }

    /// Hand picked material files/folders to the knowledge-studio page.
    func deliverMaterials(_ paths: [String]) {
        let data = (try? JSONEncoder().encode(paths)) ?? Data("[]".utf8)
        let json = String(data: data, encoding: .utf8) ?? "[]"
        evaluate("window.__dshPickedMaterials && window.__dshPickedMaterials(\(json))")
    }

    /// Hand a native-picked directory to the page so it can register and open it.
    func adoptWorkspace(_ path: String?) {
        if let path {
            evaluate("window.__dshAdoptWorkspace && window.__dshAdoptWorkspace(\(Self.jsString(path)))")
        } else {
            evaluate("window.__dshAdoptWorkspace && window.__dshAdoptWorkspace(null)")
        }
    }

    /// One string as a JSON literal, so quotes and newlines in a transcript
    /// cannot break out of the script it is embedded in.
    private static func jsString(_ value: String) -> String {
        let data = (try? JSONEncoder().encode(value)) ?? Data("\"\"".utf8)
        return String(data: data, encoding: .utf8) ?? "\"\""
    }

    func presentFailure(_ message: String) {
        host.showFailure(message, retry: #selector(AppDelegate.retryFromMenu(_:)), target: NSApp.delegate as AnyObject)
    }

    func reload() {
        if let url = WebURL.read() {
            load(url)
        } else if host.webView.url != nil {
            host.webView.reload()
        } else {
            (NSApp.delegate as? AppDelegate)?.bootServer()
        }
    }

    func webView(
        _ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        host.showWeb()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        presentFailure("页面加载失败：\(error.localizedDescription)")
    }

    func webView(
        _ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        if (error as NSError).code == NSURLErrorCancelled { return }
        presentFailure("无法连接 DSH 服务：\(error.localizedDescription)")
    }
}

// MARK: - App delegate

final class AppDelegate: NSObject, NSApplicationDelegate {
    private let server = ServerController()
    private var controllers: [HarnessWindowController] = []
    private var hasBootedServer = false
    private var signalSources: [DispatchSourceSignal] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        // One copy of the shell per user. A second copy attaches to the same
        // server and fights the first over session ownership.
        if focusRunningCopy() { return }

        trapSignals()
        buildMenu()
        server.onStateChange = { [weak self] state in
            self?.apply(state)
        }
        newWindow()
        DispatchQueue.global(qos: .utility).async { KeepAliveAgent.install() }
        bootServer()
        FolderAccess.requestKnownFolders()
        WhisperEngine.shared.prepare(progress: { _ in }, completion: { _ in })
        NSApp.activate(ignoringOtherApps: true)
    }

    /// Hand this launch over to the copy that is already running.
    ///
    /// `LSMultipleInstancesProhibited` covers the Finder/`open` path; running
    /// the executable directly bypasses LaunchServices, so the check repeats
    /// here. The lower PID wins, so two simultaneous launches cannot both yield.
    private func focusRunningCopy() -> Bool {
        guard let identifier = Bundle.main.bundleIdentifier else { return false }
        let older = NSRunningApplication
            .runningApplications(withBundleIdentifier: identifier)
            .first { $0.processIdentifier != getpid() && $0.processIdentifier < getpid() }
        guard let older else { return false }
        older.activate(options: [.activateAllWindows])
        exit(0)
    }

    /// A bare `kill` on a GUI app would otherwise strand the server child.
    private func trapSignals() {
        for sig in [SIGTERM, SIGINT, SIGHUP] {
            signal(sig, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: sig, queue: .main)
            source.setEventHandler { [weak self] in
                self?.server.handoff()
                exit(0)
            }
            source.resume()
            signalSources.append(source)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        WhisperEngine.shared.shutdown()
        server.handoff()
    }

    // MARK: lifecycle

    func bootServer() {
        for controller in controllers { controller.presentLoading() }
        if hasBootedServer {
            server.retry()
        } else {
            hasBootedServer = true
            server.start()
        }
    }

    @objc func retryFromMenu(_ sender: Any?) { bootServer() }

    private func apply(_ state: ServerController.State) {
        switch state {
        case .idle, .starting:
            for controller in controllers { controller.presentLoading() }
        case .ready(let url, _):
            for controller in controllers { controller.load(url) }
        case .failed(let message):
            for controller in controllers { controller.presentFailure(message) }
        }
    }

    /// Hand the server this app is showing to the user's default browser.
    ///
    /// The app and the browser end up on one server, which is the whole point:
    /// a session can be written by only one server at a time, so a second one
    /// would fight this window for every session lock.
    @objc func openInBrowser(_ sender: Any?) {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            let published = WebURL.read()
            let fromState: URL? = {
                if case .ready(let url, _) = self.server.state { return url }
                return nil
            }()
            let url: URL?
            if let published, WebURL.probe(published) {
                url = published
            } else if let fromState, WebURL.probe(fromState) {
                url = fromState
            } else {
                url = nil
            }
            DispatchQueue.main.async {
                guard let url else {
                    NSSound.beep()
                    return
                }
                NSWorkspace.shared.open(url)
            }
        }
    }

    @objc func openGitHubRepo(_ sender: Any?) {
        guard let url = URL(string: "https://github.com/alex-zz7/deepseek-harness") else { return }
        NSWorkspace.shared.open(url)
    }

    @objc func openRetrieveDocs(_ sender: Any?) {
        guard let url = URL(string: "https://github.com/alex-zz7/deepseek-harness/blob/main/docs/knowledge-retrieve.md") else { return }
        NSWorkspace.shared.open(url)
    }

    // MARK: dictation

    /// Voice input is process-wide: one microphone, one recogniser, and the
    /// transcript goes to whichever window is in front.
    private static let voiceInput = VoiceInput()

    /// Toggle dictation from the page's mic button.
    @objc func toggleVoice() {
        armVoice()
        Self.voiceInput.toggle()
    }

    /// Stop dictation and keep the text. A last Whisper pass runs first so the
    /// trailing words are not dropped; the page then closes the span.
    @objc func finishVoice() {
        Self.voiceInput.finish()
    }

    /// Stop dictation and drop the transcript; the page removes the span itself.
    @objc func cancelVoice() {
        Self.voiceInput.cancel()
    }

    /// Point the recogniser at the window in front: one microphone, one
    /// recogniser, and the transcript goes wherever the user is looking.
    private func armVoice() {
        let voice = Self.voiceInput
        voice.onText = { [weak self] text, isFinal in
            self?.frontWindow?.pushVoice(text, isFinal: isFinal)
        }
        voice.onState = { [weak self] state in
            self?.frontWindow?.pushVoiceState(state)
        }
        voice.onLevel = { [weak self] level in
            self?.frontWindow?.pushVoiceLevel(level)
        }
    }

    // MARK: projects

    /// Cursor-shaped folder creation from the in-page workspace menu.
    ///
    /// `scratch` makes an empty git repo immediately (no dialog). `new-folder`
    /// uses a save panel so the user picks the name and location, then `git init`.
    /// Open a vault or source path in Finder. The page cannot launch Finder
    /// itself; file:// URLs are ignored inside the web view.
    func revealInFinder(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("/"), !trimmed.contains("\0") else { return }
        let url = URL(fileURLWithPath: trimmed).standardizedFileURL
        guard url.isFileURL, url.path.hasPrefix("/") else { return }
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: url.path, isDirectory: &isDir) else {
            NSSound.beep()
            return
        }
        if isDir.boolValue {
            NSWorkspace.shared.open(url)
        } else {
            NSWorkspace.shared.activateFileViewerSelecting([url])
        }
    }

    /// Files and folders, multiple selection. Used by knowledge-studio.
    func pickMaterials() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = true
        panel.canCreateDirectories = false
        panel.prompt = "添加"
        panel.message = "可选文件或文件夹，可多选。不会改你的资料。"
        let finish: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            let paths = response == .OK ? panel.urls.map(\.path) : []
            self?.frontWindow?.deliverMaterials(paths)
        }
        if let window = frontWindow?.window {
            panel.beginSheetModal(for: window, completionHandler: finish)
        } else {
            finish(panel.runModal())
        }
    }

    func pickWorkspace(_ mode: String) {
        switch mode {
        case "scratch":
            do {
                let url = try WorkspaceFolderFactory.createScratch()
                frontWindow?.adoptWorkspace(url.path)
            } catch {
                NSSound.beep()
                frontWindow?.adoptWorkspace(nil)
            }
        case "new-folder":
            WorkspaceFolderFactory.presentNewFolder(from: frontWindow?.window) { [weak self] url in
                self?.frontWindow?.adoptWorkspace(url?.path)
            }
        default:
            break
        }
    }

    /// Present the project picker over the front window.
    ///
    /// The panel only needs the server's origin: the plugin's `/projects` route
    /// sits outside the `/api` fence and needs no token.
    @objc func openProjects() {
        guard case .ready(let url, _) = server.state else {
            NSSound.beep()
            return
        }
        guard let window = frontWindow?.window else { return }

        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.path = "/"
        components?.query = nil

        let picker = ProjectPickerController()
        picker.serverBaseURL = components?.url

        let sheet = NSWindow(contentViewController: picker)
        sheet.styleMask = [.titled, .closable]
        sheet.title = "打开项目"
        window.beginSheet(sheet, completionHandler: nil)
    }

    private var frontWindow: HarnessWindowController? {
        if let key = NSApp.keyWindow, let match = controllers.first(where: { $0.window === key }) {
            return match
        }
        return controllers.last
    }

    // MARK: windows

    @objc func newWindow() {
        let controller = HarnessWindowController()
        controllers.append(controller)
        controller.showWindow(nil)
        switch server.state {
        case .ready(let url, _): controller.load(url)
        case .failed(let message): controller.presentFailure(message)
        default: controller.presentLoading()
        }
    }

    @objc func reloadActive() {
        active()?.reload()
    }

    @objc func zoomIn() { if let c = active() { c.pageZoom += 0.1 } }
    @objc func zoomOut() { if let c = active() { c.pageZoom -= 0.1 } }
    @objc func zoomReset() { active()?.pageZoom = 1.0 }

    private func active() -> HarnessWindowController? {
        if let key = NSApp.keyWindow, let match = controllers.first(where: { $0.window === key }) {
            return match
        }
        return controllers.last
    }

    // MARK: menu

    private func buildMenu() {
        let main = NSMenu()

        // App menu
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appItem.submenu = appMenu
        let appName = "DeepSeek Harness"
        appMenu.addItem(withTitle: "关于 \(appName)", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "隐藏 \(appName)", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        let hideOthers = NSMenuItem(title: "隐藏其他", action: #selector(NSApplication.hideOtherApplications(_:)), keyEquivalent: "h")
        hideOthers.keyEquivalentModifierMask = [.command, .option]
        appMenu.addItem(hideOthers)
        appMenu.addItem(withTitle: "全部显示", action: #selector(NSApplication.unhideAllApplications(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出 \(appName)", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

        // File
        let fileItem = NSMenuItem()
        main.addItem(fileItem)
        let fileMenu = NSMenu(title: "文件")
        fileItem.submenu = fileMenu
        fileMenu.addItem(withTitle: "新建窗口", action: #selector(newWindow), keyEquivalent: "n").target = self
        fileMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        fileMenu.addItem(.separator())
        let browserItem = NSMenuItem(
            title: "在浏览器中打开",
            action: #selector(openInBrowser(_:)),
            keyEquivalent: "o")
        browserItem.keyEquivalentModifierMask = [.command, .shift]
        browserItem.target = self
        fileMenu.addItem(browserItem)

        // Edit — required for ⌘C/⌘V/⌘A to work inside the web view's text fields.
        let editItem = NSMenuItem()
        main.addItem(editItem)
        let editMenu = NSMenu(title: "编辑")
        editItem.submenu = editMenu
        editMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        let redo = NSMenuItem(title: "重做", action: Selector(("redo:")), keyEquivalent: "z")
        redo.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(redo)
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")

        // View
        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "显示")
        viewItem.submenu = viewMenu
        viewMenu.addItem(withTitle: "重新载入", action: #selector(reloadActive), keyEquivalent: "r").target = self
        let hardReload = NSMenuItem(title: "强制重新载入", action: #selector(reloadActive), keyEquivalent: "r")
        hardReload.keyEquivalentModifierMask = [.command, .shift]
        hardReload.target = self
        viewMenu.addItem(hardReload)
        viewMenu.addItem(.separator())
        viewMenu.addItem(withTitle: "放大", action: #selector(zoomIn), keyEquivalent: "+").target = self
        viewMenu.addItem(withTitle: "缩小", action: #selector(zoomOut), keyEquivalent: "-").target = self
        viewMenu.addItem(withTitle: "实际大小", action: #selector(zoomReset), keyEquivalent: "0").target = self
        viewMenu.addItem(.separator())
        let full = NSMenuItem(title: "进入全屏幕", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        full.keyEquivalentModifierMask = [.command, .control]
        viewMenu.addItem(full)

        // Help
        let helpItem = NSMenuItem()
        main.addItem(helpItem)
        let helpMenu = NSMenu(title: "帮助")
        helpItem.submenu = helpMenu
        helpMenu.addItem(withTitle: "GitHub 仓库", action: #selector(openGitHubRepo), keyEquivalent: "").target = self
        helpMenu.addItem(withTitle: "检索对比说明", action: #selector(openRetrieveDocs), keyEquivalent: "").target = self
        NSApp.helpMenu = helpMenu

        // Window
        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "窗口")
        windowItem.submenu = windowMenu
        windowMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        NSApp.windowsMenu = windowMenu

        NSApp.mainMenu = main
    }
}

// MARK: - Entry point

let arguments = CommandLine.arguments
if let flag = arguments.firstIndex(of: "--make-icon") {
    guard flag + 1 < arguments.count else {
        FileHandle.standardError.write(Data("usage: DeepSeekHarness --make-icon <out.png> [logo.svg]\n".utf8))
        exit(2)
    }
    // The logo is optional: without it the tile carries a wordmark instead.
    let logo = flag + 2 < arguments.count ? arguments[flag + 2] : nil
    makeIcon(at: arguments[flag + 1], logoPath: logo)
    exit(0)
}

let application = NSApplication.shared
let appDelegate = AppDelegate()
application.delegate = appDelegate
application.setActivationPolicy(.regular)
application.run()
