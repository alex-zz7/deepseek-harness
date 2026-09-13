// Dictation for the composer.
//
// Native on purpose. The user asked whether Doubao's component could be copied;
// it cannot — that is another vendor's proprietary UI and assets. This builds
// the same *behaviour* from Apple's own frameworks: a mic affordance whose
// results stream into the composer as you speak.
//
// Recognition runs through `SFSpeechRecognizer`, preferring on-device
// recognition when the locale supports it, so audio need not leave the machine.
//
// Continuous by design. The recogniser ends a segment the moment it believes
// the speaker stopped — silence endpointing arrives as `isFinal`, and a pause
// can just as well come back as a `noSpeechDetected`-class error. Treating
// either as "the user is done" is exactly what made the first version drop out
// at the first pause. So the audio graph now stays up for the whole session and
// only the *recognition task* is recycled: finished segments fold into the
// running transcript, which is republished on every update.
//
// @see SidebarActions.swift for the button, which is injected into the page.

import AVFoundation
import Foundation
import Speech

final class VoiceInput: NSObject {
    enum State: Equatable {
        case idle
        case starting
        case listening
        case failed(String)
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

    private lazy var recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))
    private let engine = AVAudioEngine()
    /// Guards `request`: the audio thread reads it while the main queue swaps it.
    private let lock = NSLock()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private var tapInstalled = false
    /// Set by the user, cleared only by `stop()`. Segment recycling is
    /// invisible to it — the session runs until the mic is toggled off.
    private var wantsListening = false
    private var restart: DispatchWorkItem?
    /// Text closed out by finished segments, plus the segment in flight.
    private var committed = ""
    private var partial = ""
    /// On-device recognition is preferred, but a model that is missing or
    /// broken fails instantly and repeatedly; fall back to the server
    /// recogniser rather than failing the session.
    private var useOnDevice = true
    private var fastFailures = 0
    private var segmentStarted = Date()
    /// Bumped on every recycle so a cancelled task cannot publish or restart.
    private var segmentID = 0

    /// Start listening, or stop if already listening.
    func toggle() {
        if state == .listening || state == .starting { stop() } else { beginWithPermission() }
    }

    /// Stop for real: tear the audio graph down and release the transcript span.
    func stop() { teardown(.publish) }

    /// Stop and throw the transcript away. The page removes its own span, so
    /// nothing is republished.
    func cancel() { teardown(.discard) }

    /// Stop because the message is being sent: the composer already holds the
    /// text, and republishing would rewrite it under the send.
    func finish() { teardown(.silent) }

    private enum Teardown { case publish, discard, silent }

    private func teardown(_ mode: Teardown) {
        let wasListening = wantsListening
        wantsListening = false
        restart?.cancel()
        restart = nil
        task?.cancel()
        task = nil
        setRequest(nil)

        if engine.isRunning { engine.stop() }
        if tapInstalled {
            engine.inputNode.removeTap(onBus: 0)
            tapInstalled = false
        }

        // Hand the transcript over as final so the page stops treating it as
        // replaceable — but only if this session actually produced something.
        if wasListening, mode == .publish, !transcript.isEmpty {
            onText?(transcript, true)
        }
        committed = ""
        partial = ""
        fastFailures = 0
        if case .failed = state { return }
        state = .idle
    }

    // MARK: - the pipeline

    private func beginWithPermission() {
        state = .starting

        SFSpeechRecognizer.requestAuthorization { [weak self] speechStatus in
            guard let self else { return }
            guard speechStatus == .authorized else {
                DispatchQueue.main.async { self.fail("语音识别权限被拒绝") }
                return
            }
            // `AVCaptureDevice` rather than `AVAudioApplication`: the latter is
            // macOS 14+, and this app targets 13.
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    guard granted else {
                        self.fail("麦克风权限被拒绝")
                        return
                    }
                    self.startEngine()
                }
            }
        }
    }

    private func startEngine() {
        guard let recognizer, recognizer.isAvailable else {
            state = .failed("中文识别器当前不可用")
            return
        }

        committed = ""
        partial = ""
        fastFailures = 0
        segmentID = 0
        useOnDevice = recognizer.supportsOnDeviceRecognition
        wantsListening = true
        segmentStarted = Date()

        // One tap for the whole session: the closure appends into whichever
        // request is current, so recycling a task never interrupts the audio.
        if !tapInstalled {
            let input = engine.inputNode
            let format = input.outputFormat(forBus: 0)
            input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
                guard let self else { return }
                let level = Self.level(of: buffer)
                self.lock.lock()
                self.request?.append(buffer)
                self.lock.unlock()
                self.report(level: level)
            }
            tapInstalled = true
        }

        engine.prepare()
        do {
            try engine.start()
        } catch {
            stop()
            state = .failed("无法开始录音：\(error.localizedDescription)")
            return
        }

        // Announce the session before opening the first segment: a segment that
        // refuses to start fails the session, and must not then be overwritten
        // by a stale `listening`.
        state = .listening
        beginSegment()
    }

    /// Open one recognition segment. Called when the session starts and again
    /// every time the recogniser closes a segment; the engine keeps running.
    private func beginSegment() {
        guard wantsListening else { return }
        guard let recognizer, recognizer.isAvailable else {
            fail("中文识别器当前不可用")
            return
        }

        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.taskHint = .dictation
        request.addsPunctuation = true
        request.requiresOnDeviceRecognition = useOnDevice
        setRequest(request)
        segmentStarted = Date()
        segmentID += 1
        let id = segmentID

        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async { self?.handle(id: id, result: result, error: error) }
        }
    }

    private func handle(id: Int, result: SFSpeechRecognitionResult?, error: Error?) {
        // A late callback from a cancelled or superseded task must not
        // publish an empty segment over the running transcript.
        guard wantsListening, id == segmentID else { return }

        if let result {
            let next = result.bestTranscription.formattedString
            if result.isFinal {
                committed = joined(committed, next)
                partial = ""
                fastFailures = 0
                publish()
                // The task already finished — do not cancel it, or the error
                // callback would look like a new empty utterance.
                task = nil
                setRequest(nil)
                scheduleSegment()
                return
            }
            // After a pause the same task often starts a *new* sentence and
            // drops the earlier words without sending `isFinal`. Fold the
            // previous partial into `committed` so the page is not overwritten.
            if Self.looksLikeNewUtterance(previous: partial, next: next) {
                committed = joined(committed, partial)
            }
            partial = next
            publish()
            return
        }
        guard error != nil else { return }
        committed = joined(committed, partial)
        partial = ""
        publish()
        // A pause normally surfaces here, and a pause must never end the
        // session: the segment is recycled for as long as the user keeps the
        // mic on. Only an on-device model that dies instantly over and over is
        // worth reacting to — the server recogniser still works there.
        if Date().timeIntervalSince(segmentStarted) < 0.4 {
            fastFailures += 1
            if fastFailures >= 2, useOnDevice {
                useOnDevice = false
            }
        } else {
            fastFailures = 0
        }
        scheduleSegment(cancelCurrent: true)
    }

    /// Replace the finished task after a beat, so a silent segment cannot spin.
    private func scheduleSegment(cancelCurrent: Bool = false) {
        guard wantsListening else { return }
        if cancelCurrent {
            segmentID += 1
            task?.cancel()
            task = nil
            setRequest(nil)
        }

        restart?.cancel()
        let elapsed = Date().timeIntervalSince(segmentStarted)
        let expected = segmentID
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.wantsListening, self.segmentID == expected else { return }
            self.beginSegment()
        }
        restart = work
        DispatchQueue.main.asyncAfter(deadline: .now() + (elapsed < 0.4 ? 0.5 : 0.12), execute: work)
    }

    private func fail(_ message: String) {
        stop()
        state = .failed(message)
    }

    // MARK: - text

    /// Everything this session has heard: closed segments plus the live one.
    private var transcript: String {
        joined(committed, partial)
    }

    /// Republish the running transcript. Never final: the page must keep
    /// treating it as replaceable until the user stops recording.
    private func publish() {
        guard !transcript.isEmpty else { return }
        onText?(transcript, false)
    }

    /// True when `next` is a fresh sentence, not a revision of `previous`.
    private static func looksLikeNewUtterance(previous: String, next: String) -> Bool {
        let prev = previous.trimmingCharacters(in: .whitespacesAndNewlines)
        let incoming = next.trimmingCharacters(in: .whitespacesAndNewlines)
        if prev.isEmpty || incoming.isEmpty { return false }
        let prevFold = prev.lowercased()
        let nextFold = incoming.lowercased()
        if nextFold.hasPrefix(prevFold) || prevFold.hasPrefix(nextFold) { return false }
        if nextFold.contains(prevFold) { return false }
        return true
    }

    private func joined(_ head: String, _ tail: String) -> String {
        let left = head.trimmingCharacters(in: .whitespacesAndNewlines)
        let right = tail.trimmingCharacters(in: .whitespacesAndNewlines)
        if left.isEmpty { return right }
        if right.isEmpty { return left }
        return left + " " + right
    }

    private func setRequest(_ next: SFSpeechAudioBufferRecognitionRequest?) {
        lock.lock()
        request = next
        lock.unlock()
    }

    // MARK: - level meter

    private var lastLevelSent = Date.distantPast

    /// Forward a level to the UI at ~30 Hz. Runs on the audio thread, so it only
    /// compares a timestamp and hops to the main queue.
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
