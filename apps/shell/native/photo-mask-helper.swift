import CoreGraphics
import CoreImage
import CoreVideo
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

@main
struct PhotoMaskHelper {
    static func focusFromMask(_ raw: CVPixelBuffer) throws -> [String: Double]? {
        let buffer: CVPixelBuffer
        if CVPixelBufferGetPixelFormatType(raw) == kCVPixelFormatType_OneComponent8 {
            buffer = raw
        } else {
            var converted: CVPixelBuffer?
            CVPixelBufferCreate(kCFAllocatorDefault, CVPixelBufferGetWidth(raw), CVPixelBufferGetHeight(raw),
                                kCVPixelFormatType_OneComponent8, nil, &converted)
            guard let converted else { throw NSError(domain: "PhotoMask", code: 9) }
            let ci = CIImage(cvPixelBuffer: raw)
            CIContext().render(ci, to: converted, bounds: ci.extent,
                               colorSpace: CGColorSpaceCreateDeviceGray())
            buffer = converted
        }
        CVPixelBufferLockBaseAddress(buffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(buffer, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(buffer) else { return nil }
        let w = CVPixelBufferGetWidth(buffer), h = CVPixelBufferGetHeight(buffer)
        let stride = CVPixelBufferGetBytesPerRow(buffer)
        let pixels = base.assumingMemoryBound(to: UInt8.self)
        var x0 = w, y0 = h, x1 = -1, y1 = -1
        var totalX = 0.0, totalY = 0.0, totalWeight = 0.0
        for y in 0..<h {
            for x in 0..<w where pixels[y * stride + x] > 127 {
                x0 = min(x0, x); y0 = min(y0, y)
                x1 = max(x1, x); y1 = max(y1, y)
                let weight = Double(pixels[y * stride + x]) / 255
                totalX += Double(x) * weight
                totalY += Double(y) * weight
                totalWeight += weight
            }
        }
        guard x1 >= x0 && y1 >= y0 && totalWeight > 0 else { return nil }
        return ["x": Double(x0) / Double(w), "y": Double(y0) / Double(h),
                "w": Double(x1 - x0 + 1) / Double(w), "h": Double(y1 - y0 + 1) / Double(h),
                "cx": (totalX / totalWeight + 0.5) / Double(w),
                "cy": (totalY / totalWeight + 0.5) / Double(h)]
    }

    static func main() {
        do {
            if CommandLine.arguments.count == 4 && CommandLine.arguments[1] == "--analyze" {
                try analyze(URL(fileURLWithPath: CommandLine.arguments[2]), CommandLine.arguments[3])
                return
            }
            guard CommandLine.arguments.count == 3 else { throw NSError(domain: "PhotoMask", code: 1, userInfo: [NSLocalizedDescriptionKey: "input and output paths required"]) }
            let input = URL(fileURLWithPath: CommandLine.arguments[1])
            let output = URL(fileURLWithPath: CommandLine.arguments[2])
            guard let image = CIImage(contentsOf: input, options: [.applyOrientationProperty: true]) else {
                throw NSError(domain: "PhotoMask", code: 2, userInfo: [NSLocalizedDescriptionKey: "image cannot be opened"])
            }
            let oriented = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
            let width = Int(oriented.extent.width.rounded())
            let height = Int(oriented.extent.height.rounded())
            guard width > 0 && height > 0 else { throw NSError(domain: "PhotoMask", code: 3) }
            let handler = VNImageRequestHandler(ciImage: oriented, orientation: .up, options: [:])
            let pixels: CVPixelBuffer
            let requestName: String
            if #available(macOS 14.0, *) {
                let request = VNGenerateForegroundInstanceMaskRequest()
                try handler.perform([request])
                guard let observation = request.results?.first else { throw NSError(domain: "PhotoMask", code: 4) }
                pixels = try observation.generateScaledMaskForImage(forInstances: observation.allInstances, from: handler)
                requestName = "foreground-instance"
            } else {
                let request = VNGeneratePersonSegmentationRequest()
                request.qualityLevel = .accurate
                request.outputPixelFormat = kCVPixelFormatType_OneComponent8
                try handler.perform([request])
                guard let observation = request.results?.first else { throw NSError(domain: "PhotoMask", code: 5) }
                pixels = observation.pixelBuffer
                requestName = "person-segmentation"
            }
            let byteMask: CVPixelBuffer
            if CVPixelBufferGetPixelFormatType(pixels) == kCVPixelFormatType_OneComponent8 {
                byteMask = pixels
            } else {
                var converted: CVPixelBuffer?
                CVPixelBufferCreate(kCFAllocatorDefault, CVPixelBufferGetWidth(pixels),
                                    CVPixelBufferGetHeight(pixels), kCVPixelFormatType_OneComponent8,
                                    nil, &converted)
                guard let converted else { throw NSError(domain: "PhotoMask", code: 9) }
                let ci = CIImage(cvPixelBuffer: pixels)
                CIContext().render(ci, to: converted, bounds: ci.extent,
                                   colorSpace: CGColorSpaceCreateDeviceGray())
                byteMask = converted
            }
            CVPixelBufferLockBaseAddress(byteMask, .readOnly)
            defer { CVPixelBufferUnlockBaseAddress(byteMask, .readOnly) }
            guard let base = CVPixelBufferGetBaseAddress(byteMask) else { throw NSError(domain: "PhotoMask", code: 6) }
            let maskWidth = CVPixelBufferGetWidth(byteMask)
            let maskHeight = CVPixelBufferGetHeight(byteMask)
            let stride = CVPixelBufferGetBytesPerRow(byteMask)
            let source = base.assumingMemoryBound(to: UInt8.self)
            var gray = [UInt8](repeating: 0, count: width * height)
            for y in 0..<height {
                let sy = min(maskHeight - 1, y * maskHeight / height)
                for x in 0..<width {
                    let sx = min(maskWidth - 1, x * maskWidth / width)
                    gray[y * width + x] = source[sy * stride + sx]
                }
            }
            let data = Data(gray) as CFData
            guard let provider = CGDataProvider(data: data),
                  let cgImage = CGImage(width: width, height: height, bitsPerComponent: 8,
                                        bitsPerPixel: 8, bytesPerRow: width,
                                        space: CGColorSpaceCreateDeviceGray(),
                                        bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                                        provider: provider, decode: nil, shouldInterpolate: false,
                                        intent: .defaultIntent),
                  let destination = CGImageDestinationCreateWithURL(output as CFURL, UTType.png.identifier as CFString, 1, nil)
            else { throw NSError(domain: "PhotoMask", code: 7) }
            CGImageDestinationAddImage(destination, cgImage, nil)
            guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "PhotoMask", code: 8) }
            print("{\"request\":\"\(requestName)\",\"width\":\(width),\"height\":\(height)}")
        } catch {
            fputs("photo mask failed: \(error.localizedDescription)\n", stderr)
            exit(1)
        }
    }

    static func analyze(_ input: URL, _ kind: String) throws {
        guard let image = CIImage(contentsOf: input, options: [.applyOrientationProperty: true]) else {
            throw NSError(domain: "PhotoMask", code: 2)
        }
        let oriented = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
        let handler = VNImageRequestHandler(ciImage: oriented, orientation: .up, options: [:])
        var answer: [String: Any] = ["available": false]
        if kind == "horizon" {
            let request = VNDetectHorizonRequest()
            try? handler.perform([request])
            if let observation = request.results?.first {
                answer = ["available": true, "degrees": max(-45, min(45, -observation.angle * 180 / .pi))]
            }
        } else if kind == "saliency" {
            var focus: [String: Double]?
            var basis = "foreground"
            if #available(macOS 14.0, *) {
                let foreground = VNGenerateForegroundInstanceMaskRequest()
                try? handler.perform([foreground])
                if let observation = foreground.results?.first,
                   let mask = try? observation.generateScaledMaskForImage(forInstances: observation.allInstances, from: handler) {
                    focus = try? focusFromMask(mask)
                }
            } else {
                let person = VNGeneratePersonSegmentationRequest()
                person.qualityLevel = .accurate
                person.outputPixelFormat = kCVPixelFormatType_OneComponent8
                try? handler.perform([person])
                if let mask = person.results?.first?.pixelBuffer {
                    focus = try? focusFromMask(mask)
                    basis = "person"
                }
            }
            if focus == nil {
                let request = VNGenerateAttentionBasedSaliencyImageRequest()
                try? handler.perform([request])
                if let region = request.results?.first?.salientObjects?.max(by: {
                    $0.boundingBox.width * $0.boundingBox.height < $1.boundingBox.width * $1.boundingBox.height
                })?.boundingBox {
                    focus = ["x": region.minX, "y": 1 - region.maxY,
                             "w": region.width, "h": region.height]
                    basis = "saliency"
                }
            }
            if let focus {
                answer = ["available": true, "focus": focus, "basis": basis]
            }
        }
        let data = try JSONSerialization.data(withJSONObject: answer, options: [.sortedKeys])
        print(String(decoding: data, as: UTF8.self))
    }
}
