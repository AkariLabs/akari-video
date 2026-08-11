// vision-tracks-helper — 顔ランドマーク・手ポーズ抽出ヘルパー（macOS Vision framework）
//
// 役割は 1 つだけである。stdin から届く raw BGRA フレーム列をフレーム単位で読み、
// VNDetectFaceLandmarksRequest / VNDetectHumanHandPoseRequest（--kinds で選択、両方
// 指定時は 1 回の perform() 呼び出しで両方検出）を実行し、検出結果を JSON Lines
// （1 フレーム 1 行）として stdout へ流す。入力フレーム数と出力行数は 1:1 で、
// コンテナ・時刻（t 秒への変換）・複数トラックファイルへの組み立ては一切扱わない
// （ラッパー vision-tracks.mjs の責務。person-matte-helper.swift と同じ分離）。
//
// 座標系: このヘルパーが標準出力へ書く座標はすべて **0〜1 正規化・左上原点**
// （契約 docs/contract-2026-08-11-analysis-vision-tracks-v0.md §2 の座標系規約）。
// Vision framework は正規化 0〜1 だが **左下原点**（y は上向き）で座標を返すため、
// y 反転（y' = 1 - y）をここで行ってから出力する。顔ランドマークの各点は
// VNFaceLandmarkRegion2D.normalizedPoints が「顔矩形を基準にした 0〜1」で返る
// （画像全体基準ではない）ため、顔矩形で一度アフィン変換してから y 反転する
// （absoluteLandmarkPoint 参照）。手の関節点は VNRecognizedPoint.location が
// 最初から画像全体基準の 0〜1（Vision 座標系）なので y 反転のみで済む。
//
// 手の各関節は Apple のガイド値に沿って `--joint-confidence`（既定 0.3）未満を
// キーごと省略する（契約 §2.2「捏造ゼロ — 無い関節は無い」）。顔ランドマークは
// Vision が 6 領域（瞳 2・目 2・唇 2）をまとめて計算するため、`landmarks` が nil
// （顔向き・遮蔽などで計算に失敗）の検出は行単位でスキップし、捏造しない。
//
// ビルド:
//   swiftc -O -parse-as-library vision-tracks-helper.swift -o vision-tracks-helper
//
// ラッパーがソースより古いバイナリを自動で作り直すため、通常は手で叩かない。
// バイナリはコミットしない（skills/analyze-footage/.gitignore を参照）。ネットワークからツールを導入せず、
// 既存の Command Line Tools だけを使う。
//
// 使い方:
//   vision-tracks-helper --width 1280 --height 720 --kinds face,hand
//                        [--joint-confidence 0.3] [--metrics <path>]
//
// 成功時は stdout が JSON Lines（1 フレーム 1 行）、終了コード 0。失敗時は stderr へ
// 1 行の JSON（{"error": "..."}）を書いて終了コード 1 で終わる。

import CoreGraphics
import CoreVideo
import Foundation
import Vision

private struct HelperError: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct Options {
    var width = 0
    var height = 0
    var kinds: Set<String> = []
    var jointConfidence: Float = 0.3
    var metricsPath: String?
}

@main
struct VisionTracksHelper {
    static func main() {
        // 下流（ラッパーの stdout 読み取り）が先に落ちたとき、SIGPIPE で即死せず
        // write のエラーとして扱う（person-matte-helper と同じ規律）。
        signal(SIGPIPE, SIG_IGN)
        do {
            let options = try parseArguments()
            let metrics = try extract(options)
            if let metricsPath = options.metricsPath {
                let data = try JSONSerialization.data(
                    withJSONObject: metrics, options: [.prettyPrinted, .sortedKeys])
                try data.write(to: URL(fileURLWithPath: metricsPath))
            }
        } catch {
            fail(error.localizedDescription)
        }
    }

    // MARK: - 引数

    private static func parseArguments() throws -> Options {
        var options = Options()
        var iterator = CommandLine.arguments.dropFirst().makeIterator()
        while let argument = iterator.next() {
            switch argument {
            case "--width":
                options.width = try integer(iterator.next(), for: argument)
            case "--height":
                options.height = try integer(iterator.next(), for: argument)
            case "--kinds":
                let raw = try value(iterator.next(), for: argument)
                options.kinds = Set(raw.split(separator: ",").map { String($0) })
            case "--joint-confidence":
                options.jointConfidence = try float(iterator.next(), for: argument)
            case "--metrics":
                options.metricsPath = try value(iterator.next(), for: argument)
            default:
                throw HelperError(message: "unknown argument: \(argument)")
            }
        }
        guard options.width > 0, options.height > 0 else {
            throw HelperError(message: "--width and --height are required and must be positive")
        }
        guard !options.kinds.isEmpty, options.kinds.isSubset(of: ["face", "hand"]) else {
            throw HelperError(message: "--kinds must be a comma list drawn from face,hand")
        }
        guard options.jointConfidence >= 0, options.jointConfidence <= 1 else {
            throw HelperError(message: "--joint-confidence must be within 0...1")
        }
        return options
    }

    private static func value(_ raw: String?, for name: String) throws -> String {
        guard let raw, !raw.hasPrefix("--") else {
            throw HelperError(message: "\(name) requires a value")
        }
        return raw
    }

    private static func integer(_ raw: String?, for name: String) throws -> Int {
        guard let parsed = Int(try value(raw, for: name)) else {
            throw HelperError(message: "\(name) requires an integer value")
        }
        return parsed
    }

    private static func float(_ raw: String?, for name: String) throws -> Float {
        guard let parsed = Float(try value(raw, for: name)) else {
            throw HelperError(message: "\(name) requires a numeric value")
        }
        return parsed
    }

    // MARK: - 抽出本体

    private static func extract(_ options: Options) throws -> [String: Any] {
        let width = options.width
        let height = options.height
        let frameBytes = width * height * 4

        var requests: [VNRequest] = []
        var faceRequest: VNDetectFaceLandmarksRequest?
        var handRequest: VNDetectHumanHandPoseRequest?
        if options.kinds.contains("face") {
            let request = VNDetectFaceLandmarksRequest()
            faceRequest = request
            requests.append(request)
        }
        if options.kinds.contains("hand") {
            let request = VNDetectHumanHandPoseRequest()
            request.maximumHandCount = 2
            handRequest = request
            requests.append(request)
        }

        // 同一の sequence handler へ presentation order のまま送る（person-matte-helper
        // と同じ流儀）。顔・手いずれも単フレーム検出で時間的連続性には依存しないが、
        // ヘルパー間で流儀を揃え、フレームごとに handler を作り直すコストも避ける。
        let handler = VNSequenceRequestHandler()
        let input = try makePixelBuffer(width: width, height: height)
        let frame = UnsafeMutableRawPointer.allocate(byteCount: frameBytes, alignment: 64)
        defer { frame.deallocate() }

        var frames = 0
        var visionSeconds = 0.0
        var faceDetections = 0
        var handDetections = 0
        var framesWithFaceLandmarksNil = 0
        let startedAt = now()
        let stdout = FileHandle.standardOutput

        while try readExactly(frameBytes, into: frame) {
            copy(from: frame, into: input, width: width, height: height)

            let visionStartedAt = now()
            try handler.perform(requests, on: input, orientation: .up)
            visionSeconds += now() - visionStartedAt

            var line: [String: Any] = [:]
            if let faceRequest {
                let observations = (faceRequest.results ?? [])
                var faceEntries: [[String: Any]] = []
                for observation in observations {
                    guard let landmarks = observation.landmarks,
                        let entry = faceDetectionJSON(observation: observation, landmarks: landmarks)
                    else {
                        if observation.landmarks == nil { framesWithFaceLandmarksNil += 1 }
                        continue
                    }
                    faceEntries.append(entry)
                }
                faceDetections += faceEntries.count
                line["face"] = faceEntries
            }
            if let handRequest {
                let observations = (handRequest.results ?? [])
                var handEntries: [[String: Any]] = []
                for observation in observations {
                    if let entry = handDetectionJSON(
                        observation: observation, jointConfidence: options.jointConfidence)
                    {
                        handEntries.append(entry)
                    }
                }
                handDetections += handEntries.count
                line["hand"] = handEntries
            }

            try writeLine(line, to: stdout)
            frames += 1
        }

        let totalSeconds = now() - startedAt
        return [
            "frames": frames,
            "width": width,
            "height": height,
            "kinds": options.kinds.sorted(),
            "joint_confidence": options.jointConfidence,
            "vision_seconds": visionSeconds,
            "total_seconds": totalSeconds,
            "vision_ms_per_frame": frames > 0 ? visionSeconds / Double(frames) * 1000 : 0,
            "face_detections": faceDetections,
            "hand_detections": handDetections,
            // landmarks が nil で捨てた検出数。捏造ゼロの裏付け（実測を report.md へ）。
            "face_landmarks_nil_skipped": framesWithFaceLandmarksNil,
        ]
    }

    // MARK: - 座標変換（Vision 左下原点 → 契約の左上原点）

    /// 正規化 0〜1・左下原点の y を左上原点へ反転する。x は不変。
    private static func flipY(_ y: CGFloat) -> CGFloat { 1 - y }

    /// 0〜1 へ丸める。Vision は画面外へはみ出た遮蔽点・端の点を外挿することがあり
    /// （実測: 手が縁で切れたフレームで `y = 1.0015...` を観測）、素通しすると契約の
    /// 「すべて 0〜1 正規化」規約を破る。person-matte-helper のアルファ値クランプ
    /// （`min(max(value, 0), 255)`）と同じ防御を座標にも適用する。捏造ではなく、
    /// Vision 自身が返した値を契約の範囲へ丸めるだけである。
    private static func clampUnit(_ value: CGFloat) -> CGFloat { min(max(value, 0), 1) }

    /// 顔矩形（Vision 座標系、左下原点）を契約の左上原点へ反転する。
    /// box は [x, y, w, h] のまま x/w/h は不変、y は `1 - y - h` に置き換わる。
    private static func flippedBox(_ box: CGRect) -> [Double] {
        [
            Double(clampUnit(box.origin.x)),
            Double(clampUnit(1 - box.origin.y - box.height)),
            Double(clampUnit(box.width)),
            Double(clampUnit(box.height)),
        ]
    }

    /// VNFaceLandmarkRegion2D の点は「顔矩形基準の 0〜1」（Vision 座標系）で返る。
    /// 顔矩形でアフィン変換して画像全体基準の 0〜1（Vision 座標系）に直してから、
    /// 契約の左上原点へ y 反転する。
    private static func absoluteLandmarkPoint(_ local: CGPoint, in faceBox: CGRect) -> [Double] {
        let absoluteX = faceBox.origin.x + local.x * faceBox.width
        let absoluteY = faceBox.origin.y + local.y * faceBox.height
        return [Double(clampUnit(absoluteX)), Double(clampUnit(flipY(absoluteY)))]
    }

    private static func regionPoints(_ region: VNFaceLandmarkRegion2D?, in faceBox: CGRect) -> [[Double]]? {
        guard let region, region.pointCount > 0 else { return nil }
        return region.normalizedPoints.map { absoluteLandmarkPoint($0, in: faceBox) }
    }

    // MARK: - 顔ランドマーク

    private static func faceDetectionJSON(
        observation: VNFaceObservation, landmarks: VNFaceLandmarks2D
    ) -> [String: Any]? {
        // v0 必須の 6 領域（契約 §2.1）。1 つでも計算できていない検出は捏造せず捨てる。
        guard let leftPupil = regionPoints(landmarks.leftPupil, in: observation.boundingBox)?.first,
            let rightPupil = regionPoints(landmarks.rightPupil, in: observation.boundingBox)?.first,
            let leftEye = regionPoints(landmarks.leftEye, in: observation.boundingBox),
            let rightEye = regionPoints(landmarks.rightEye, in: observation.boundingBox),
            let outerLips = regionPoints(landmarks.outerLips, in: observation.boundingBox),
            let innerLips = regionPoints(landmarks.innerLips, in: observation.boundingBox)
        else {
            return nil
        }
        return [
            "box": flippedBox(observation.boundingBox),
            "conf": Double(observation.confidence),
            "landmarks": [
                "left_pupil": leftPupil,
                "right_pupil": rightPupil,
                "left_eye": leftEye,
                "right_eye": rightEye,
                "outer_lips": outerLips,
                "inner_lips": innerLips,
            ],
        ]
    }

    // MARK: - 手ポーズ

    // VNHumanHandPoseObservation.JointName と契約の snake_case キーの対応表（21 関節）。
    private static let handJoints: [(VNHumanHandPoseObservation.JointName, String)] = [
        (.wrist, "wrist"),
        (.thumbCMC, "thumb_cmc"), (.thumbMP, "thumb_mp"), (.thumbIP, "thumb_ip"), (.thumbTip, "thumb_tip"),
        (.indexMCP, "index_mcp"), (.indexPIP, "index_pip"), (.indexDIP, "index_dip"), (.indexTip, "index_tip"),
        (.middleMCP, "middle_mcp"), (.middlePIP, "middle_pip"), (.middleDIP, "middle_dip"), (.middleTip, "middle_tip"),
        (.ringMCP, "ring_mcp"), (.ringPIP, "ring_pip"), (.ringDIP, "ring_dip"), (.ringTip, "ring_tip"),
        (.littleMCP, "little_mcp"), (.littlePIP, "little_pip"), (.littleDIP, "little_dip"), (.littleTip, "little_tip"),
    ]

    private static func chiralityString(_ chirality: VNChirality) -> String {
        switch chirality {
        case .left: return "left"
        case .right: return "right"
        default: return "unknown"
        }
    }

    private static func handDetectionJSON(
        observation: VNHumanHandPoseObservation, jointConfidence: Float
    ) -> [String: Any]? {
        var joints: [String: [Double]] = [:]
        for (jointName, key) in handJoints {
            guard let point = try? observation.recognizedPoint(jointName), point.confidence >= jointConfidence
            else { continue }
            joints[key] = [Double(clampUnit(point.location.x)), Double(clampUnit(flipY(point.location.y)))]
        }
        // 閾値未満で全関節が落ちた検出はゼロ件の joints を持つ object になる。捏造ではなく
        // 事実（「検出はしたが信頼できる関節が無かった」）なのでそのまま出す。
        return [
            "chirality": chiralityString(observation.chirality),
            "conf": Double(observation.confidence),
            "joints": joints,
        ]
    }

    // MARK: - ピクセルバッファ

    private static func makePixelBuffer(width: Int, height: Int) throws -> CVPixelBuffer {
        var buffer: CVPixelBuffer?
        let status = CVPixelBufferCreate(
            kCFAllocatorDefault, width, height, kCVPixelFormatType_32BGRA,
            [kCVPixelBufferIOSurfacePropertiesKey: [:] as CFDictionary] as CFDictionary,
            &buffer)
        guard status == kCVReturnSuccess, let created = buffer else {
            throw HelperError(message: "CVPixelBufferCreate failed with status \(status)")
        }
        return created
    }

    private static func copy(
        from frame: UnsafeMutableRawPointer, into buffer: CVPixelBuffer, width: Int, height: Int
    ) {
        CVPixelBufferLockBaseAddress(buffer, [])
        defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return }
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        let rowBytes = width * 4
        for row in 0..<height {
            base.advanced(by: row * stride)
                .copyMemory(from: frame.advanced(by: row * rowBytes), byteCount: rowBytes)
        }
    }

    // MARK: - stdin / stdout

    /// stdin から正確に `count` バイト読む。フレーム境界での EOF なら false を返す。
    /// 途中で切れた場合はフレーム欠けなのでエラーにする（黙って短いフレームを流さない）。
    private static func readExactly(_ count: Int, into buffer: UnsafeMutableRawPointer) throws -> Bool {
        var filled = 0
        while filled < count {
            let read = Darwin.read(0, buffer.advanced(by: filled), count - filled)
            if read == 0 {
                if filled == 0 { return false }
                throw HelperError(message: "stdin ended mid-frame (\(filled)/\(count) bytes)")
            }
            if read < 0 {
                if errno == EINTR { continue }
                throw HelperError(message: "read from stdin failed: \(String(cString: strerror(errno)))")
            }
            filled += read
        }
        return true
    }

    private static func writeLine(_ object: [String: Any], to handle: FileHandle) throws {
        var data = try JSONSerialization.data(withJSONObject: object, options: [])
        data.append(0x0A)  // "\n"
        try handle.write(contentsOf: data)
    }

    // MARK: - 雑務

    private static func now() -> Double {
        Double(DispatchTime.now().uptimeNanoseconds) / 1e9
    }

    private static func fail(_ message: String) -> Never {
        let payload = ["error": message]
        if let data = try? JSONSerialization.data(withJSONObject: payload) {
            FileHandle.standardError.write(data)
            FileHandle.standardError.write(Data("\n".utf8))
        }
        Foundation.exit(1)
    }
}
