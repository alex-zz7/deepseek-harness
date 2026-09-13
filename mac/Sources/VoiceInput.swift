// Dictation for the composer.
//
// Cursor's mic is a streaming Whisper backend. Apple's `SFSpeechRecognizer`
// is a different stack — it endpoint-segments on pauses and is the reason
// earlier versions dropped words or jumped sentences. This records PCM and
// sends it to `WhisperEngine`, the same model family Cursor uses.

import AVFoundation
import Foundation

final class VoiceInput: NSObject {
    enum State: Equatable {
        case idle
        case starting(String)
        case listening
        case cancelled
        case failed(String)

        var isBusy: Bool {
            switch self {
            case .starting, .listening: return true
            default: return false
            }
        }
    }

    /// Called on the main queue whenever the state changes.
    var onState: ((State) -> Void)?
    /// Called on the main queue with the running transcript and whether it is final.
    var onText: ((String, Bool) -> Void)?
    /// Called on the main queue ~30 times a second with the input level, 0…1.
    var onLevel: ((Float) -> Void)?

    private(set) var state: State = .idle {
        didSet {
            guard state != oldValue else { return }
            onState?(state)
        }
    }

    private var engine = AVAudioEngine()
    private let sampleLock = NSLock()
    private let work = DispatchQueue(label: "dsh.voice.flush")
    private var samples: [Int16] = []
    /// Fractional input-frame cursor so resampling is continuous across taps.
    private var resampleCursor: Double = 0
    private var tapInstalled = false
    private var transcribeFailures = 0
    private var wantsListening = false
    private var flushTimer: DispatchSourceTimer?
    private var flushBusy = false
    private var flushAgain = false
    private var flushAgainFinal = false
    private var flushCompletions: [() -> Void] = []
    private var lastFlushCount = 0
    private var lastPublished = ""
    /// Closed-out sentences. Later flushes must not send this audio again.
    private var committed = ""
    private var sessionID = 0
    private var cancelled = false

    /// Start listening, or stop if already listening.
    func toggle() {
        if state.isBusy { stop() } else { beginWithPermission() }
    }

    /// Stop for real: one last transcript, then release the span.
    func stop() {
        endSession(mode: .publish)
    }

    /// Stop and throw the transcript away. The page restores the field itself.
    func cancel() {
        cancelled = true
        sessionID += 1
        wantsListening = false
        stopFlushes()
        teardown(.discard)
    }

    /// Stop because the message is being sent: the composer already holds the
    /// text, so the last flush must not rewrite it after the page has moved on.
    func finish() {
        endSession(mode: .silent)
    }

    private enum Teardown { case publish, discard, silent }

    private func endSession(mode: Teardown) {
        wantsListening = false
        stopFlushes()
        enqueueFlush(final: true) { [weak self] in
            self?.teardown(mode)
        }
    }

    private func teardown(_ mode: Teardown) {
        discardEngine()

        if mode == .publish, !lastPublished.isEmpty {
            onText?(lastPublished, true)
        }

        sampleLock.lock()
        samples.removeAll(keepingCapacity: false)
        sampleLock.unlock()
        lastFlushCount = 0
        lastPublished = ""
        committed = ""
        flushAgain = false
        flushAgainFinal = false
        if case .failed = state { return }
        if mode == .discard {
            state = .cancelled
            return
        }
        state = .idle
    }

    // MARK: - start

    private func beginWithPermission() {
        state = .starting("正在启动麦克风…")
        AVCaptureDevice.requestAccess(for: .audio) { [weak self] granted in
            DispatchQueue.main.async {
                guard let self else { return }
                guard granted else {
                    self.fail("麦克风权限被拒绝")
                    return
                }
                // Record first. Whisper can warm up while the first words
                // are already in the buffer — waiting for the model is what
                // dropped the start of the take.
                self.sessionID += 1
                self.cancelled = false
                self.committed = ""
                self.startEngine()
                if !WhisperEngine.shared.isReady {
                    WhisperEngine.shared.prepare(
                        progress: { _ in },
                        completion: { [weak self] result in
                            guard let self else { return }
                            if case .failure(let error) = result, self.state == .listening {
                                self.fail(error.localizedDescription)
                            }
                        }
                    )
                }
            }
        }
    }

    private func startEngine() {
        sampleLock.lock()
        samples.removeAll(keepingCapacity: true)
        sampleLock.unlock()
        lastFlushCount = 0
        lastPublished = ""
        transcribeFailures = 0
        resampleCursor = 0
        committed = ""
        wantsListening = true

        // A leftover graph from a previous session can make `prepare()` abort
        // the process. Tear it down and use a fresh engine each take.
        discardEngine()
        engine = AVAudioEngine()

        let input = engine.inputNode
        let hardware = input.inputFormat(forBus: 0)
        let format = (hardware.sampleRate > 0 && hardware.channelCount > 0)
            ? hardware
            : input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            fail("麦克风当前不可用")
            return
        }

        // installTap / start raise NSException on an invalid graph — Swift
        // `try` does not catch those, which is why the first Whisper build
        // aborted the app the moment the mic was opened.
        var caught: NSError?
        let installed = DSHCatchException({
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                self?.ingest(buffer)
            }
        }, &caught)
        guard installed else {
            fail("无法开始录音：\(caught?.localizedDescription ?? "音频图初始化失败")")
            return
        }
        tapInstalled = true

        var startError: NSError?
        let started = DSHCatchException({
            do {
                try self.engine.start()
            } catch {
                startError = error as NSError
            }
        }, &caught)
        if !started || !engine.isRunning {
            fail("无法开始录音：\((startError ?? caught)?.localizedDescription ?? "音频引擎启动失败")")
            return
        }

        state = .listening
        startFlushes()
    }

    private func discardEngine() {
        if engine.isRunning { engine.stop() }
        if tapInstalled {
            _ = DSHCatchException({
                self.engine.inputNode.removeTap(onBus: 0)
            }, nil)
            tapInstalled = false
        }
        engine.reset()
    }

    private func ingest(_ buffer: AVAudioPCMBuffer) {
        let level = Self.level(of: buffer)
        report(level: level)

        // Same samples the meter sees — do not go through AVAudioConverter.
        // On this machine the converter was producing empty PCM while the
        // waveform still moved, so Whisper never heard anything.
        let mono = Self.monoFloats(from: buffer)
        guard !mono.isEmpty else { return }
        let inRate = max(buffer.format.sampleRate, 1)
        let step = inRate / 16_000
        var cursor = resampleCursor
        var pcm: [Int16] = []
        pcm.reserveCapacity(max(1, Int(Double(mono.count) / step) + 1))
        while cursor < Double(mono.count) {
            let sample = max(-1, min(1, mono[Int(cursor)]))
            pcm.append(Int16(sample * 32767))
            cursor += step
        }
        resampleCursor = cursor - Double(mono.count)
        guard !pcm.isEmpty else { return }
        sampleLock.lock()
        samples.append(contentsOf: pcm)
        sampleLock.unlock()
    }

    /// Mix every channel down to mono floats in -1…1.
    private static func monoFloats(from buffer: AVAudioPCMBuffer) -> [Float] {
        let frames = Int(buffer.frameLength)
        let channels = Int(max(buffer.format.channelCount, 1))
        guard frames > 0 else { return [] }
        var out = [Float](repeating: 0, count: frames)
        if let data = buffer.floatChannelData {
            if buffer.format.isInterleaved {
                for index in 0 ..< frames {
                    var sum: Float = 0
                    for channel in 0 ..< channels {
                        sum += data[0][index * channels + channel]
                    }
                    out[index] = sum / Float(channels)
                }
            } else {
                for index in 0 ..< frames {
                    var sum: Float = 0
                    for channel in 0 ..< channels {
                        sum += data[channel][index]
                    }
                    out[index] = sum / Float(channels)
                }
            }
            return out
        }
        if let data = buffer.int16ChannelData {
            if buffer.format.isInterleaved {
                for index in 0 ..< frames {
                    var sum: Float = 0
                    for channel in 0 ..< channels {
                        sum += Float(data[0][index * channels + channel]) / 32768
                    }
                    out[index] = sum / Float(channels)
                }
            } else {
                for index in 0 ..< frames {
                    var sum: Float = 0
                    for channel in 0 ..< channels {
                        sum += Float(data[channel][index]) / 32768
                    }
                    out[index] = sum / Float(channels)
                }
            }
            return out
        }
        return []
    }

    // MARK: - flush

    private func startFlushes() {
        let timer = DispatchSource.makeTimerSource(queue: .main)
        timer.schedule(deadline: .now() + 0.5, repeating: 1.0)
        timer.setEventHandler { [weak self] in
            self?.enqueueFlush(final: false)
        }
        timer.resume()
        flushTimer = timer
    }

    private func stopFlushes() {
        flushTimer?.cancel()
        flushTimer = nil
    }

    private func enqueueFlush(final: Bool, completion: (() -> Void)? = nil) {
        if let completion { flushCompletions.append(completion) }
        if flushBusy {
            flushAgain = true
            flushAgainFinal = flushAgainFinal || final
            return
        }
        flushBusy = true
        let isFinal = final
        let id = sessionID
        work.async { [weak self] in
            guard let self else { return }
            let outcome = self.captureAndTranscribe(force: isFinal)
            DispatchQueue.main.async {
                guard self.sessionID == id, !self.cancelled else {
                    self.flushBusy = false
                    let done = self.flushCompletions
                    self.flushCompletions = []
                    done.forEach { $0() }
                    return
                }
                switch outcome {
                case .skipped:
                    break
                case .text(let text):
                    self.transcribeFailures = 0
                    if !text.isEmpty {
                        self.lastPublished = text
                        self.onText?(text, isFinal)
                    }
                case .failed(let message):
                    self.transcribeFailures += 1
                    VoiceLog.line("flush error (\(self.transcribeFailures)): \(message)")
                    if self.transcribeFailures >= 2 {
                        self.fail(message)
                        let done = self.flushCompletions
                        self.flushCompletions = []
                        done.forEach { $0() }
                        return
                    }
                }
                self.flushBusy = false
                if self.flushAgain {
                    let againFinal = self.flushAgainFinal
                    self.flushAgain = false
                    self.flushAgainFinal = false
                    self.enqueueFlush(final: againFinal)
                } else {
                    let done = self.flushCompletions
                    self.flushCompletions = []
                    done.forEach { $0() }
                }
            }
        }
    }

    private enum FlushOutcome {
        case skipped
        case text(String)
        case failed(String)
    }

    private func captureAndTranscribe(force: Bool) -> FlushOutcome {
        guard WhisperEngine.shared.isReady else {
            VoiceLog.line("flush skip: whisper not ready, still buffering")
            return .skipped
        }

        sampleLock.lock()
        let copy = samples
        sampleLock.unlock()

        let minSamples = Int(0.45 * 16_000)
        if copy.isEmpty {
            return committed.isEmpty ? .skipped : .text(committed)
        }
        if !Self.hasSpeech(copy) {
            // Only throw away a *quiet* buffer. A rising take (rms ~0.02) was
            // being deleted before it crossed the old gate, so nothing ever
            // reached Whisper.
            let energy = Self.rms(copy)
            if energy < 0.008, copy.count >= Int(1.5 * 16_000) {
                sampleLock.lock()
                samples.removeAll(keepingCapacity: true)
                sampleLock.unlock()
                lastFlushCount = 0
            }
            VoiceLog.line("flush skip: no speech (rms=\(String(format: "%.4f", energy)))")
            return committed.isEmpty ? .skipped : .text(committed)
        }
        if copy.count < minSamples, !force {
            VoiceLog.line("flush skip: \(copy.count) samples")
            return committed.isEmpty ? .skipped : .text(committed)
        }
        if !force, copy.count == lastFlushCount { return .skipped }
        lastFlushCount = copy.count

        let wav = WaveFile.encode(copy)
        let last = ServerRecord.directory.appendingPathComponent("whisper-last.wav")
        try? wav.write(to: last)
        VoiceLog.line("flush tail \(copy.count) samples, committed=\(committed.count) chars")

        let sem = DispatchSemaphore(value: 0)
        var live = ""
        var errorMessage: String?
        WhisperEngine.shared.transcribe(wav: wav) { result in
            switch result {
            case .success(let raw):
                live = WhisperEngine.clean(raw)
                VoiceLog.line("whisper tail: \(live.isEmpty ? "(empty)" : live)")
            case .failure(let error):
                errorMessage = error.localizedDescription
            }
            sem.signal()
        }
        if sem.wait(timeout: .now() + 50) == .timedOut {
            return .failed("语音识别超时")
        }
        if let errorMessage { return .failed(errorMessage) }
        if live.isEmpty {
            return committed.isEmpty ? .skipped : .text(committed)
        }

        let full = Self.joined(committed, live)
        let shouldCommit = force
            || (copy.count >= Int(2.4 * 16_000) && Self.tailIsQuiet(copy))
        if shouldCommit, !live.isEmpty {
            committed = full
            sampleLock.lock()
            samples.removeAll(keepingCapacity: true)
            sampleLock.unlock()
            lastFlushCount = 0
            VoiceLog.line("committed \(committed)")
        }
        return .text(full.isEmpty ? lastPublished : full)
    }

    private static func joined(_ head: String, _ tail: String) -> String {
        let left = head.trimmingCharacters(in: .whitespacesAndNewlines)
        let right = tail.trimmingCharacters(in: .whitespacesAndNewlines)
        if left.isEmpty { return right }
        if right.isEmpty { return left }
        if left.last.map(isCJK) == true || right.first.map(isCJK) == true {
            return left + right
        }
        if left.last?.isWhitespace == true || right.first?.isWhitespace == true {
            return left + right
        }
        return left + " " + right
    }

    private static func isCJK(_ character: Character) -> Bool {
        character.unicodeScalars.contains { scalar in
            (0x4E00 ... 0x9FFF).contains(scalar.value)
                || (0x3400 ... 0x4DBF).contains(scalar.value)
                || (0x3040 ... 0x30FF).contains(scalar.value)
        }
    }

    private static func tailIsQuiet(_ samples: [Int16], seconds: Double = 0.5) -> Bool {
        let count = min(samples.count, Int(seconds * 16_000))
        guard count > 0 else { return false }
        return rms(samples.suffix(count)) < 0.022
    }

    /// Room noise on this machine sits around 0.003–0.008 RMS; a normal
    /// utterance lands around 0.02. Gate on a short window so a word in the
    /// middle of a longer buffer still counts.
    private static func hasSpeech(_ samples: [Int16]) -> Bool {
        let window = Int(0.2 * 16_000)
        guard !samples.isEmpty else { return false }
        if samples.count < window {
            return rms(samples) > 0.012
        }
        var index = 0
        while index + window <= samples.count {
            if rms(samples[index ..< (index + window)]) > 0.014 { return true }
            index += window / 2
        }
        return rms(samples.suffix(window)) > 0.014
    }

    private static func rms<S: Sequence>(_ samples: S) -> Double where S.Element == Int16 {
        var sum: Double = 0
        var count = 0
        for sample in samples {
            let value = Double(sample)
            sum += value * value
            count += 1
        }
        guard count > 0 else { return 0 }
        return sqrt(sum / Double(count)) / 32768.0
    }

    private func fail(_ message: String) {
        cancelled = true
        sessionID += 1
        wantsListening = false
        stopFlushes()
        discardEngine()
        state = .failed(message)
    }

    // MARK: - level meter

    private var lastLevelSent = Date.distantPast

    /// Forward a level to the UI at ~30 Hz. Runs on the audio thread.
    private func report(level: Float) {
        let now = Date()
        guard now.timeIntervalSince(lastLevelSent) >= 1.0 / 30 else { return }
        lastLevelSent = now
        DispatchQueue.main.async { [weak self] in self?.onLevel?(level) }
    }

    /// RMS of the tapped buffer, mapped from dBFS onto 0…1 for the meter.
    private static func level(of buffer: AVAudioPCMBuffer) -> Float {
        guard let channel = buffer.floatChannelData?[0] else { return 0 }
        let count = Int(buffer.frameLength)
        guard count > 0 else { return 0 }
        var sum: Float = 0
        for index in 0 ..< count {
            let sample = channel[index]
            sum += sample * sample
        }
        let rms = sqrtf(sum / Float(count))
        let decibels = 20 * log10f(max(rms, 1e-7))
        return max(0, min(1, (decibels + 50) / 50))
    }
}
