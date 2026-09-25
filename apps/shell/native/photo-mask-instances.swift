import CoreGraphics
import CoreImage
import CoreVideo
import Foundation
import ImageIO
import UniformTypeIdentifiers
import Vision

enum PhotoMaskInstances {
    static func combine(output: String, invert: Bool, inputs: [String]) throws {
        guard !inputs.isEmpty else { throw NSError(domain: "PhotoMask", code: 16) }
        var union: [UInt8] = []
        var width = 0, height = 0
        let context = CIContext()
        for path in inputs {
            guard let image = CIImage(contentsOf: URL(fileURLWithPath: path)) else { throw NSError(domain: "PhotoMask", code: 17) }
            let w = Int(image.extent.width), h = Int(image.extent.height)
            if union.isEmpty { width = w; height = h; union = [UInt8](repeating: 0, count: w * h) }
            guard w == width && h == height else { throw NSError(domain: "PhotoMask", code: 18) }
            var pixel: CVPixelBuffer?
            CVPixelBufferCreate(kCFAllocatorDefault, w, h, kCVPixelFormatType_OneComponent8, nil, &pixel)
            guard let pixel else { throw NSError(domain: "PhotoMask", code: 19) }
            context.render(image, to: pixel, bounds: CGRect(x: 0, y: 0, width: w, height: h), colorSpace: CGColorSpaceCreateDeviceGray())
            CVPixelBufferLockBaseAddress(pixel, .readOnly)
            guard let base = CVPixelBufferGetBaseAddress(pixel) else { throw NSError(domain: "PhotoMask", code: 20) }
            let bytes = base.assumingMemoryBound(to: UInt8.self), stride = CVPixelBufferGetBytesPerRow(pixel)
            for y in 0..<h { for x in 0..<w { union[y * w + x] = max(union[y * w + x], bytes[y * stride + x]) } }
            CVPixelBufferUnlockBaseAddress(pixel, .readOnly)
        }
        if invert { union = union.map { 255 - $0 } }
        let data = Data(union) as CFData
        guard let provider = CGDataProvider(data: data),
              let image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: width,
                                  space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent),
              let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: output) as CFURL, UTType.png.identifier as CFString, 1, nil)
        else { throw NSError(domain: "PhotoMask", code: 21) }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "PhotoMask", code: 22) }
    }
    static func run(input: String, output: String, mode: String) throws {
        guard let image = CIImage(contentsOf: URL(fileURLWithPath: input), options: [.applyOrientationProperty: true]) else {
            throw NSError(domain: "PhotoMask", code: 10)
        }
        let oriented = image.transformed(by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY))
        let width = Int(oriented.extent.width.rounded()), height = Int(oriented.extent.height.rounded())
        let handler = VNImageRequestHandler(ciImage: oriented, orientation: .up, options: [:])
        let folder = URL(fileURLWithPath: output, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        var names = [[String: Any]]()
        if #available(macOS 14.0, *) {
            if mode == "people" {
                let request = VNGeneratePersonInstanceMaskRequest()
                try handler.perform([request])
                if let result = request.results?.first, !result.allInstances.isEmpty {
                    try save(result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler), width, height, folder.appendingPathComponent("all.png"))
                    names.append(["id": "all", "label": "人物だけ", "file": "all.png"])
                    for (number, instance) in result.allInstances.enumerated() {
                        let file = "person-\(number + 1).png"
                        try save(result.generateScaledMaskForImage(forInstances: IndexSet(integer: instance), from: handler), width, height, folder.appendingPathComponent(file))
                        names.append(["id": "person-\(number + 1)", "label": "人物 \(number + 1)", "file": file])
                    }
                }
            } else {
                let request = VNGenerateForegroundInstanceMaskRequest()
                try handler.perform([request])
                if let result = request.results?.first, !result.allInstances.isEmpty {
                    try save(result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler), width, height, folder.appendingPathComponent("all.png"))
                    names.append(["id": "all", "label": "自動", "file": "all.png"])
                    for (number, instance) in result.allInstances.enumerated() {
                        let file = "subject-\(number + 1).png"
                        try save(result.generateScaledMaskForImage(forInstances: IndexSet(integer: instance), from: handler), width, height, folder.appendingPathComponent(file))
                        names.append(["id": "subject-\(number + 1)", "label": "被写体 \(number + 1)", "file": file])
                    }
                }
            }
        } else {
            throw NSError(domain: "PhotoMask", code: 11, userInfo: [NSLocalizedDescriptionKey: "この Mac では使えません"])
        }
        let json = try JSONSerialization.data(withJSONObject: ["width": width, "height": height, "instances": names], options: [.sortedKeys])
        print(String(data: json, encoding: .utf8)!)
    }

    static func save(_ pixels: CVPixelBuffer, _ width: Int, _ height: Int, _ url: URL) throws {
        let context = CIContext()
        let ci = CIImage(cvPixelBuffer: pixels)
        var converted: CVPixelBuffer?
        CVPixelBufferCreate(kCFAllocatorDefault, width, height, kCVPixelFormatType_OneComponent8, nil, &converted)
        guard let converted else { throw NSError(domain: "PhotoMask", code: 12) }
        context.render(ci, to: converted, bounds: CGRect(x: 0, y: 0, width: width, height: height), colorSpace: CGColorSpaceCreateDeviceGray())
        CVPixelBufferLockBaseAddress(converted, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(converted, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(converted) else { throw NSError(domain: "PhotoMask", code: 13) }
        let stride = CVPixelBufferGetBytesPerRow(converted)
        let source = base.assumingMemoryBound(to: UInt8.self)
        var gray = [UInt8](repeating: 0, count: width * height)
        for y in 0..<height { for x in 0..<width { gray[y * width + x] = source[y * stride + x] } }
        guard let provider = CGDataProvider(data: Data(gray) as CFData),
              let bitmap = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: width,
                                   space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                                   provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent),
              let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
        else { throw NSError(domain: "PhotoMask", code: 14) }
        CGImageDestinationAddImage(destination, bitmap, nil)
        guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "PhotoMask", code: 15) }
    }
}
