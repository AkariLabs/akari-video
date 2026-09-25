import CoreGraphics
import CoreImage
import CoreML
import Foundation
import ImageIO
import UniformTypeIdentifiers

@main
struct PhotoSamServerTests {
    static func main() throws {
        let logits = try MLMultiArray(shape: [1, 1, 1, 2], dataType: .float32)
        logits[[0, 0, 0, 0] as [NSNumber]] = -10
        logits[[0, 0, 0, 1] as [NSNumber]] = 1
        let (pixels, area) = PhotoSamServer.bilinearMask(logits, candidate: 0,
            lowWidth: 2, lowHeight: 1, width: 4, height: 1)
        precondition(pixels == [0, 0, 0, 255] && area == 1,
            "logits must be interpolated before thresholding")

        let bytes = Data([255, 0, 0, 255, 0, 0]) as CFData
        guard let provider = CGDataProvider(data: bytes),
              let image = CGImage(width: 2, height: 3, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: 2,
                                  space: CGColorSpaceCreateDeviceGray(),
                                  bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)
        else { fatalError("test image") }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("akari-photo-orientation-\(UUID().uuidString).jpg")
        defer { try? FileManager.default.removeItem(at: url) }
        guard let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
            fatalError("test destination")
        }
        CGImageDestinationAddImage(destination, image, [kCGImagePropertyOrientation: 6] as CFDictionary)
        precondition(CGImageDestinationFinalize(destination))
        guard let oriented = CIImage(contentsOf: url, options: [.applyOrientationProperty: true]) else {
            fatalError("oriented test image")
        }
        precondition(Int(oriented.extent.width) == 3 && Int(oriented.extent.height) == 2,
            "EXIF orientation must swap the source dimensions")
        print("photo SAM raster and EXIF orientation: PASS")
    }
}
