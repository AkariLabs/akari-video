import CoreGraphics
import CoreImage
import CoreVideo
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

@main
struct PhotoMaskHelper {
    static func main() {
        do {
            if CommandLine.arguments.count == 5 && CommandLine.arguments[1] == "instances" {
                try PhotoMaskInstances.run(input: CommandLine.arguments[2], output: CommandLine.arguments[3], mode: CommandLine.arguments[4])
                return
            }
            if CommandLine.arguments.count == 3 && CommandLine.arguments[1] == "sam-serve" {
                try PhotoSamServer.run(models: CommandLine.arguments[2])
                return
            }
            if CommandLine.arguments.count >= 5 && CommandLine.arguments[1] == "combine" {
                try PhotoMaskInstances.combine(output: CommandLine.arguments[2], invert: CommandLine.arguments[3] == "invert",
                    inputs: Array(CommandLine.arguments.dropFirst(4)))
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
}
