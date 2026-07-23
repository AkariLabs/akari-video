// person-matte-helper — 人物マット抽出ヘルパー（macOS Vision person segmentation）
//
// 役割は 1 つだけである。stdin から届く raw BGRA フレーム列をフレーム単位で読み、
// VNGeneratePersonSegmentationRequest で人物マットを求め、RGB = 元フレーム /
// A = マット の切り抜きフレームを raw BGRA として stdout へ流す。
// 入出力のフレーム数は 1:1 で、このヘルパーはコンテナ・時刻・fps を一切扱わない。
//
// デコード（回転補正・拡縮・fps 統一）と WebM への圧縮は、ラッパー
// person-matte.mjs が前後に繋ぐ ffmpeg が担う。アルファ付き動画を ffmpeg の
// デコーダに通すとアルファが無言で落ちるが、ここで ffmpeg に渡すのはアルファを
// 持たない入力と、コンテナを持たない raw フレームだけなので、その罠は踏まない。
//
// アルファは straight（非 premultiplied）で書く。マット値をそのままアルファへ入れ、
// RGB は元フレームの値を触らずに通すため、定義上 straight になる。CoreImage の
// 合成（CIBlendWithMask）を経由すると結果が linear 空間で premultiplied になり、
// straight として解釈する側（ffmpeg / ブラウザ）で半透明の輪郭が暗くなる。
// unpremultiplyingAlpha() を挟んでも CVPixelBuffer への render で再び premultiply
// されるため打ち消せない（実測: alpha=0.51 の画素で出力/入力 = 0.69。straight なら 1.00）。
// そのため色管理を伴う経路を使わず、マットの線形拡大だけを自前で行う。
//
// ビルド:
//   swiftc -O -parse-as-library person-matte-helper.swift -o person-matte-helper
//
// ラッパーがソースより古いバイナリを自動で作り直すため、通常は手で叩かない。
// バイナリはコミットしない（skills/analyze-footage/.gitignore を参照）。ネットワークからツールを導入せず、
// 既存の Command Line Tools だけを使う。
//
// 使い方:
//   person-matte-helper --width 1280 --height 720
//                       [--quality fast|balanced|accurate] [--metrics <path>]
//
// 成功時は stdout が raw BGRA、終了コード 0。失敗時は stderr へ 1 行の JSON
// （{"error": "..."}）を書いて終了コード 1 で終わる。

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
    var quality = "balanced"
    var metricsPath: String?
}

/// 拡大先 1 画素ぶんの線形補間係数。フレーム間で変わらないので一度だけ作って使い回す。
private struct Interpolation {
    let low: Int
    let high: Int
    let weight: Float
}

private struct AlphaStats {
    var transparent = 0
    var partial = 0
}

@main
struct PersonMatteHelper {
    static func main() {
        // 下流（ffmpeg エンコーダ）が先に落ちたとき、SIGPIPE で即死せず write のエラーとして扱う。
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
            case "--quality":
                options.quality = try value(iterator.next(), for: argument)
            case "--metrics":
                options.metricsPath = try value(iterator.next(), for: argument)
            default:
                throw HelperError(message: "unknown argument: \(argument)")
            }
        }
        guard options.width > 0, options.height > 0 else {
            throw HelperError(message: "--width and --height are required and must be positive")
        }
        guard ["fast", "balanced", "accurate"].contains(options.quality) else {
            throw HelperError(message: "--quality must be fast, balanced or accurate")
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

    private static func qualityLevel(_ name: String)
        -> VNGeneratePersonSegmentationRequest.QualityLevel
    {
        switch name {
        case "fast": return .fast
        case "accurate": return .accurate
        default: return .balanced
        }
    }

    // MARK: - 抽出本体

    private static func extract(_ options: Options) throws -> [String: Any] {
        let width = options.width
        let height = options.height
        let frameBytes = width * height * 4

        let request = VNGeneratePersonSegmentationRequest()
        request.qualityLevel = qualityLevel(options.quality)
        request.outputPixelFormat = kCVPixelFormatType_OneComponent8
        // 同一の sequence handler へ presentation order のまま送り、Vision がフレーム間の
        // 連続性を使えるようにする。フレームごとに handler を作り直さない。
        let handler = VNSequenceRequestHandler()

        let input = try makePixelBuffer(width: width, height: height)

        // stdin からの読み出し、マットの合成、stdout への書き出しで共用する連続バッファ。
        // CVPixelBuffer は行パディングを持ちうるので、外部との受け渡しはこの詰めた形で行う。
        let frame = UnsafeMutableRawPointer.allocate(byteCount: frameBytes, alignment: 64)
        defer { frame.deallocate() }

        var frames = 0
        var visionSeconds = 0.0
        var transparentPixels = 0
        var partialPixels = 0
        var maskWidth = 0
        var maskHeight = 0
        var columns: [Interpolation] = []
        var rows: [Interpolation] = []
        let startedAt = now()

        while try readExactly(frameBytes, into: frame) {
            copy(from: frame, into: input, width: width, height: height)

            let visionStartedAt = now()
            try handler.perform([request], on: input, orientation: .up)
            visionSeconds += now() - visionStartedAt

            guard let observation = request.results?.first else {
                throw HelperError(message: "person segmentation returned no result at frame \(frames)")
            }
            let mask = observation.pixelBuffer
            if maskWidth == 0 {
                // マットは quality ごとの固定サイズで返り、入力のアスペクト比とも一致しない
                // （Vision が内部で歪めている）。元フレームの矩形へ単純に線形拡大すれば
                // 幾何が正しく戻ることはスパイクの実画で確認済み。
                maskWidth = CVPixelBufferGetWidth(mask)
                maskHeight = CVPixelBufferGetHeight(mask)
                columns = interpolationTable(source: maskWidth, target: width)
                rows = interpolationTable(source: maskHeight, target: height)
            }

            let stats = applyAlpha(
                from: mask, to: frame, width: width, height: height, columns: columns, rows: rows)
            transparentPixels += stats.transparent
            partialPixels += stats.partial
            try writeAll(frame, frameBytes)
            frames += 1
        }

        let totalSeconds = now() - startedAt
        let pixels = max(frames * width * height, 1)
        return [
            "frames": frames,
            "width": width,
            "height": height,
            "quality": options.quality,
            "mask_width": maskWidth,
            "mask_height": maskHeight,
            "vision_seconds": visionSeconds,
            "total_seconds": totalSeconds,
            "vision_ms_per_frame": frames > 0 ? visionSeconds / Double(frames) * 1000 : 0,
            // マットが本当に抜けているかの数値的な証拠。全面不透明（= 抜けていない）なら
            // transparent が 0 に張り付く。partial は髪・輪郭の半透明画素の割合。
            "alpha_transparent_ratio": Double(transparentPixels) / Double(pixels),
            "alpha_partial_ratio": Double(partialPixels) / Double(pixels),
        ]
    }

    private static func interpolationTable(source: Int, target: Int) -> [Interpolation] {
        (0..<target).map { index in
            // 画素中心どうしを対応させる（端で半画素ずれない）。
            let position = (Float(index) + 0.5) * Float(source) / Float(target) - 0.5
            let clamped = min(max(position, 0), Float(source - 1))
            let low = Int(clamped)
            return Interpolation(
                low: low, high: min(low + 1, source - 1), weight: clamped - Float(low))
        }
    }

    /// マット（OneComponent8）を線形拡大しながら、フレームのアルファへ直接書き込む。
    /// RGB は元フレームのまま残すので、結果は straight alpha になる。
    /// 完全な透明部分だけ RGB を 0 にする（背景の絵を残すと見えない領域にビットを使うため）。
    private static func applyAlpha(
        from mask: CVPixelBuffer, to frame: UnsafeMutableRawPointer, width: Int, height: Int,
        columns: [Interpolation], rows: [Interpolation]
    ) -> AlphaStats {
        CVPixelBufferLockBaseAddress(mask, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(mask, .readOnly) }
        var stats = AlphaStats()
        guard let base = CVPixelBufferGetBaseAddress(mask) else { return stats }
        let stride = CVPixelBufferGetBytesPerRow(mask)

        for row in 0..<height {
            let vertical = rows[row]
            let top = base.advanced(by: vertical.low * stride).assumingMemoryBound(to: UInt8.self)
            let bottom = base.advanced(by: vertical.high * stride).assumingMemoryBound(to: UInt8.self)
            let destination = frame.advanced(by: row * width * 4).assumingMemoryBound(to: UInt8.self)
            for column in 0..<width {
                let horizontal = columns[column]
                let upper = Float(top[horizontal.low])
                    + (Float(top[horizontal.high]) - Float(top[horizontal.low])) * horizontal.weight
                let lower = Float(bottom[horizontal.low])
                    + (Float(bottom[horizontal.high]) - Float(bottom[horizontal.low]))
                    * horizontal.weight
                let value = upper + (lower - upper) * vertical.weight
                let alpha = UInt8(min(max(value.rounded(), 0), 255))

                let offset = column * 4
                if alpha == 0 {
                    destination[offset] = 0
                    destination[offset + 1] = 0
                    destination[offset + 2] = 0
                }
                destination[offset + 3] = alpha
                if alpha < 8 {
                    stats.transparent += 1
                } else if alpha < 248 {
                    stats.partial += 1
                }
            }
        }
        return stats
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

    private static func writeAll(_ buffer: UnsafeMutableRawPointer, _ count: Int) throws {
        var written = 0
        while written < count {
            let wrote = Darwin.write(1, buffer.advanced(by: written), count - written)
            if wrote < 0 {
                if errno == EINTR { continue }
                throw HelperError(message: "write to stdout failed: \(String(cString: strerror(errno)))")
            }
            written += wrote
        }
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
