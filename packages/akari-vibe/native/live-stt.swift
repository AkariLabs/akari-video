// マイク → SpeechAnalyzer（ja-JP）→ 途中経過つきの認識結果を JSONL で stdout に流す。
// 公開リポ skills/analyze-footage/bin/speechanalyzer-helper.swift（ファイル入力版）のライブ入力版。
// 1 行 = {"type":"stt","t":経過秒,"final":Bool,"text":String}。volatile（途中経過）は同じ区間を上書きしていく。
import AVFoundation
import CoreMedia
import Foundation
import Speech

func emit(_ object: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.withoutEscapingSlashes]) else { return }
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

func fail(_ message: String) -> Never {
    emit(["type": "error", "message": message])
    Foundation.exit(1)
}

@main
struct LiveSTT {
    static func main() async {
        guard #available(macOS 26.0, *) else { fail("macOS 26 以降が必要です") }
        // --file <wav>: 録音済み音声を実時間のペースで流し込む（マイクなしで途中経過の出方を再現・計測する）
        let fileArg = CommandLine.arguments.firstIndex(of: "--file").map { CommandLine.arguments[$0 + 1] }
        guard fileArg != nil ? true : await AVCaptureDevice.requestAccess(for: .audio) else {
            fail("マイクの使用が許可されていません（システム設定 > プライバシーとセキュリティ > マイク で AKARI Video を許可してください）")
        }
        do {
            let locale = Locale(identifier: "ja-JP")
            guard SpeechTranscriber.isAvailable else { fail("SpeechTranscriber が使えません") }
            let supportedLocale = await SpeechTranscriber.supportedLocale(equivalentTo: locale) ?? locale
            let transcriber = SpeechTranscriber(
                locale: supportedLocale,
                transcriptionOptions: [],
                reportingOptions: [.volatileResults, .fastResults],
                attributeOptions: []
            )
            let modules: [any SpeechModule] = [transcriber]
            if await AssetInventory.status(forModules: modules) != .installed {
                emit(["type": "status", "message": "音声認識モデルをダウンロード中…"])
                guard let request = try await AssetInventory.assetInstallationRequest(supporting: modules) else {
                    fail("音声認識モデルのインストール要求を作れません")
                }
                try await request.downloadAndInstall()
            }
            guard let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: modules) else {
                fail("SpeechAnalyzer の入力フォーマットを決められません")
            }

            let analyzer = SpeechAnalyzer(modules: modules)
            let (inputSequence, inputBuilder) = AsyncStream<AnalyzerInput>.makeStream()

            let engine = AVAudioEngine()
            let audioFile = try fileArg.map { try AVAudioFile(forReading: URL(fileURLWithPath: $0)) }
            let micFormat = audioFile?.processingFormat ?? engine.inputNode.outputFormat(forBus: 0)
            guard micFormat.sampleRate > 0, let converter = AVAudioConverter(from: micFormat, to: analyzerFormat) else {
                fail("マイク入力を開けません（入力デバイスを確認してください）")
            }
            converter.primeMethod = .none
            let ratio = analyzerFormat.sampleRate / micFormat.sampleRate
            let startedAt = Date()
            var lastLevelAt = 0.0
            let feed: (AVAudioPCMBuffer) -> Void = { buffer in
                // 音量（RMS）を約 10Hz で流す: 認識結果より先に「声が入っている」を画面へ返し、声→文字のラグを測るため
                let now = Date().timeIntervalSince(startedAt)
                if now - lastLevelAt >= 0.1, buffer.frameLength > 0 {
                    lastLevelAt = now
                    var sum: Float = 0
                    let n = Int(buffer.frameLength)
                    if let f = buffer.floatChannelData?[0] { for i in 0..<n { sum += f[i] * f[i] } }
                    else if let q = buffer.int16ChannelData?[0] { for i in 0..<n { let v = Float(q[i]) / 32768; sum += v * v } }
                    emit(["type": "level", "t": now, "rms": Double((sum / Float(n)).squareRoot())])
                }
                let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 64
                guard let converted = AVAudioPCMBuffer(pcmFormat: analyzerFormat, frameCapacity: capacity) else { return }
                var fed = false
                var conversionError: NSError?
                converter.convert(to: converted, error: &conversionError) { _, status in
                    if fed { status.pointee = .noDataNow; return nil }
                    fed = true
                    status.pointee = .haveData
                    return buffer
                }
                if conversionError == nil, converted.frameLength > 0 {
                    inputBuilder.yield(AnalyzerInput(buffer: converted))
                }
            }
            if let audioFile {
                Task.detached {
                    let chunk = AVAudioFrameCount(micFormat.sampleRate / 10)
                    while audioFile.framePosition < audioFile.length {
                        guard let buffer = AVAudioPCMBuffer(pcmFormat: micFormat, frameCapacity: chunk) else { break }
                        try? audioFile.read(into: buffer, frameCount: chunk)
                        if buffer.frameLength == 0 { break }
                        feed(buffer)
                        try? await Task.sleep(nanoseconds: 100_000_000)
                    }
                    emit(["type": "status", "message": "file-end", "t": Date().timeIntervalSince(startedAt)])
                    inputBuilder.finish()
                }
            } else {
                engine.inputNode.installTap(onBus: 0, bufferSize: 2048, format: micFormat) { buffer, _ in feed(buffer) }
                engine.prepare()
                try engine.start()
            }
            emit(["type": "ready", "locale": supportedLocale.identifier, "micSampleRate": micFormat.sampleRate])
            Task {
                do { try await analyzer.start(inputSequence: inputSequence) }
                catch { fail("SpeechAnalyzer: \(error)") }
            }
            for try await result in transcriber.results {
                let text = String(result.text.characters)
                guard !text.isEmpty else { continue }
                if fileArg != nil, result.isFinal == false, CommandLine.arguments.contains("--quiet-partials") { continue }
                emit(["type": "stt", "t": Date().timeIntervalSince(startedAt), "final": result.isFinal, "text": text])
            }
        } catch {
            fail("\(error)")
        }
    }
}
