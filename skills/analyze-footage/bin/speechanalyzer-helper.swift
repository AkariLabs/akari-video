import AVFoundation
import CoreMedia
import Foundation
import Speech

struct Word: Codable {
    let text: String
    let start: Double
    let end: Double
}

struct Segment: Codable {
    let text: String
    let start: Double
    let end: Double
    let words: [Word]
}

struct Output: Codable {
    let engine: String
    let locale: String
    let input: String
    let assetStatusBefore: String
    let assetStatusAfter: String
    let assetInstallationSeconds: Double
    let transcript: String
    let segments: [Segment]
    let words: [Word]
}

func statusName(_ status: AssetInventory.Status) -> String {
    switch status {
    case .unsupported: return "unsupported"
    case .supported: return "supported"
    case .downloading: return "downloading"
    case .installed: return "installed"
    @unknown default: return "unknown"
    }
}

func seconds(_ time: CMTime) -> Double {
    let value = CMTimeGetSeconds(time)
    return value.isFinite ? value : 0
}

@main
struct SpeechAnalyzerHelper {
    static func main() async {
        do {
            guard #available(macOS 26.0, *) else {
                throw NSError(domain: "SpeechAnalyzerHelper", code: 1,
                              userInfo: [NSLocalizedDescriptionKey: "macOS 26 or later is required"])
            }
            guard CommandLine.arguments.count == 2 else {
                throw NSError(domain: "SpeechAnalyzerHelper", code: 2,
                              userInfo: [NSLocalizedDescriptionKey: "usage: speechanalyzer-helper INPUT_AUDIO"])
            }

            let inputPath = CommandLine.arguments[1]
            let locale = Locale(identifier: "ja-JP")
            guard SpeechTranscriber.isAvailable else {
                throw NSError(domain: "SpeechAnalyzerHelper", code: 3,
                              userInfo: [NSLocalizedDescriptionKey: "SpeechTranscriber is unavailable"])
            }
            let supportedLocale = await SpeechTranscriber.supportedLocale(equivalentTo: locale) ?? locale

            let transcriber = SpeechTranscriber(
                locale: supportedLocale,
                transcriptionOptions: [],
                reportingOptions: [],
                attributeOptions: [.audioTimeRange]
            )
            let modules: [any SpeechModule] = [transcriber]
            let statusBefore = await AssetInventory.status(forModules: modules)
            let installStart = ContinuousClock.now
            if statusBefore != .installed {
                guard let request = try await AssetInventory.assetInstallationRequest(supporting: modules) else {
                    throw NSError(domain: "SpeechAnalyzerHelper", code: 5,
                                  userInfo: [NSLocalizedDescriptionKey: "Speech model installation request unavailable"])
                }
                try await request.downloadAndInstall()
            }
            let installDuration = ContinuousClock.now - installStart
            let installationSeconds = Double(installDuration.components.seconds)
                + Double(installDuration.components.attoseconds) / 1_000_000_000_000_000_000
            let statusAfter = await AssetInventory.status(forModules: modules)

            let audioFile = try AVAudioFile(forReading: URL(fileURLWithPath: inputPath))
            let analyzer = SpeechAnalyzer(modules: modules)
            var segments: [Segment] = []

            async let analysis: Void = {
                try await analyzer.start(inputAudioFile: audioFile, finishAfterFile: true)
            }()

            for try await result in transcriber.results {
                guard result.isFinal else { continue }
                var words: [Word] = []
                for run in result.text.runs {
                    guard let timeRange = run.audioTimeRange else { continue }
                    let text = String(result.text[run.range].characters)
                    guard !text.isEmpty else { continue }
                    let start = seconds(timeRange.start)
                    let end = seconds(CMTimeRangeGetEnd(timeRange))
                    guard end > start else { continue }
                    words.append(Word(text: text, start: start, end: end))
                }
                let text = String(result.text.characters)
                let start = seconds(result.range.start)
                let end = seconds(CMTimeRangeGetEnd(result.range))
                segments.append(Segment(text: text, start: start, end: end, words: words))
            }
            try await analysis

            segments.sort { $0.start < $1.start }
            let allWords = segments.flatMap(\.words).sorted { $0.start < $1.start }
            let transcript = segments.map(\.text).joined(separator: "\n")
            let output = Output(
                engine: "macOS SpeechAnalyzer/SpeechTranscriber",
                locale: supportedLocale.identifier,
                input: URL(fileURLWithPath: inputPath).lastPathComponent,
                assetStatusBefore: statusName(statusBefore),
                assetStatusAfter: statusName(statusAfter),
                assetInstallationSeconds: installationSeconds,
                transcript: transcript,
                segments: segments,
                words: allWords
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            FileHandle.standardOutput.write(try encoder.encode(output))
            FileHandle.standardOutput.write(Data("\n".utf8))
        } catch {
            FileHandle.standardError.write(Data("SpeechAnalyzerHelper error: \(error)\n".utf8))
            Foundation.exit(1)
        }
    }
}
