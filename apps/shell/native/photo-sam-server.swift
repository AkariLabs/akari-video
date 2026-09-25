import CoreGraphics
import CoreML
import CoreImage
import Foundation
import ImageIO
import UniformTypeIdentifiers

/** Line-delimited request/response protocol. Models and the latest image embedding remain resident. */
enum PhotoSamServer {
    static let modelNames = ["ImageEncoder", "PromptEncoder", "MaskDecoder"]
    static func run(models directory: String) throws {
        let root = URL(fileURLWithPath: directory, isDirectory: true)
        let configuration = MLModelConfiguration()
        configuration.computeUnits = .cpuAndGPU
        var loaded: [String: MLModel] = [:]
        for name in modelNames {
            let stem = "SAM2_1Tiny\(name)FLOAT16"
            let compiled = root.appendingPathComponent("compiled/\(stem).mlmodelc")
            if !FileManager.default.fileExists(atPath: compiled.path) {
                let source = root.appendingPathComponent("\(stem).mlpackage")
                let temporary = try MLModel.compileModel(at: source)
                try FileManager.default.createDirectory(at: compiled.deletingLastPathComponent(), withIntermediateDirectories: true)
                try FileManager.default.copyItem(at: temporary, to: compiled)
            }
            loaded[name] = try MLModel(contentsOf: compiled, configuration: configuration)
        }
        guard let encoder = loaded["ImageEncoder"], let prompt = loaded["PromptEncoder"], let decoder = loaded["MaskDecoder"] else {
            throw NSError(domain: "PhotoSam", code: 1)
        }
        var currentHash = ""
        var currentWidth = 0, currentHeight = 0
        var orientedInput: URL?
        var embedding: MLFeatureProvider?
        print("{\"ready\":true}")
        fflush(stdout)
        while let line = readLine() {
            do {
                guard let data = line.data(using: .utf8),
                      let request = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let op = request["op"] as? String else { throw NSError(domain: "PhotoSam", code: 2) }
                let hash = request["hash"] as? String ?? ""
                if op == "prepare" {
                    guard let path = request["input"] as? String else { throw NSError(domain: "PhotoSam", code: 3) }
                    // The model sees the same upright pixels and source coordinates as Vision and the preview.
                    guard let source = CIImage(contentsOf: URL(fileURLWithPath: path), options: [.applyOrientationProperty: true]) else {
                        throw NSError(domain: "PhotoSam", code: 8)
                    }
                    let upright = source.transformed(by: CGAffineTransform(translationX: -source.extent.minX, y: -source.extent.minY))
                    currentWidth = Int(upright.extent.width.rounded())
                    currentHeight = Int(upright.extent.height.rounded())
                    guard currentWidth > 0 && currentHeight > 0,
                          let cgImage = CIContext().createCGImage(upright, from: upright.extent) else {
                        throw NSError(domain: "PhotoSam", code: 8)
                    }
                    if let orientedInput { try? FileManager.default.removeItem(at: orientedInput) }
                    let preparedURL = FileManager.default.temporaryDirectory
                        .appendingPathComponent("akari-photo-sam-\(UUID().uuidString).png")
                    guard let destination = CGImageDestinationCreateWithURL(preparedURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {
                        throw NSError(domain: "PhotoSam", code: 9)
                    }
                    CGImageDestinationAddImage(destination, cgImage, nil)
                    guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "PhotoSam", code: 9) }
                    orientedInput = preparedURL
                    let key = encoder.modelDescription.inputDescriptionsByName.keys.first!
                    let constraint = encoder.modelDescription.inputDescriptionsByName[key]!.imageConstraint!
                    // Core ML applies the image encoder's declared 1024-pixel input constraint here.
                    let input = try MLDictionaryFeatureProvider(dictionary: [key: MLFeatureValue(imageAt: preparedURL, constraint: constraint)])
                    embedding = try encoder.prediction(from: input)
                    currentHash = hash
                    print("{\"ok\":true,\"op\":\"prepare\"}")
                } else if op == "click" {
                    guard currentHash == hash, let embedding,
                          let x = request["x"] as? Double, let y = request["y"] as? Double,
                          let output = request["output"] as? String,
                          x >= 0, x <= 1, y >= 0, y <= 1 else { throw NSError(domain: "PhotoSam", code: 4) }
                    let points = try MLMultiArray(shape: [1, 1, 2], dataType: .float32)
                    points[[0, 0, 0] as [NSNumber]] = NSNumber(value: x * 1024)
                    points[[0, 0, 1] as [NSNumber]] = NSNumber(value: y * 1024)
                    let labels = try MLMultiArray(shape: [1, 1], dataType: .int32)
                    labels[[0, 0] as [NSNumber]] = 1
                    let p = try prompt.prediction(from: MLDictionaryFeatureProvider(dictionary: [
                        "points": MLFeatureValue(multiArray: points), "labels": MLFeatureValue(multiArray: labels)
                    ]))
                    var values: [String: MLFeatureValue] = [:]
                    for key in ["image_embedding", "feats_s0", "feats_s1"] { values[key] = embedding.featureValue(for: key)! }
                    values["sparse_embedding"] = p.featureValue(for: "sparse_embeddings")!
                    values["dense_embedding"] = p.featureValue(for: "dense_embeddings")!
                    let result = try decoder.prediction(from: MLDictionaryFeatureProvider(dictionary: values))
                    let masks = result.featureValue(for: "low_res_masks")!.multiArrayValue!
                    let scores = result.featureValue(for: "scores")!.multiArrayValue!
                    let shape = masks.shape.map(\.intValue)
                    let folder = URL(fileURLWithPath: output, isDirectory: true)
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    var candidates = [[String: Any]]()
                    for k in 0..<min(3, shape[1]) {
                        let (pixels, area) = bilinearMask(masks, candidate: k,
                            lowWidth: shape[3], lowHeight: shape[2], width: currentWidth, height: currentHeight)
                        let file = "candidate-\(k).png"
                        try save(pixels, currentWidth, currentHeight, folder.appendingPathComponent(file))
                        candidates.append(["id": "candidate-\(k)", "file": file, "area": area,
                                           "score": scores[[0, k] as [NSNumber]].doubleValue])
                    }
                    let response = try JSONSerialization.data(withJSONObject: ["ok": true, "op": "click", "candidates": candidates])
                    print(String(data: response, encoding: .utf8)!)
                } else { throw NSError(domain: "PhotoSam", code: 5) }
            } catch {
                let message = error.localizedDescription.replacingOccurrences(of: "\"", with: "'")
                print("{\"ok\":false,\"message\":\"\(message)\"}")
            }
            fflush(stdout)
        }
        if let orientedInput { try? FileManager.default.removeItem(at: orientedInput) }
    }

    static func bilinearMask(_ logits: MLMultiArray, candidate: Int,
                             lowWidth: Int, lowHeight: Int, width: Int, height: Int) -> ([UInt8], Int) {
        var pixels = [UInt8](repeating: 0, count: width * height)
        var area = 0
        for y in 0..<height {
            let lowY = (Double(y) + 0.5) * Double(lowHeight) / Double(height) - 0.5
            let y0 = max(0, min(lowHeight - 1, Int(floor(lowY))))
            let y1 = min(lowHeight - 1, y0 + 1)
            let fy = max(0, min(1, lowY - Double(y0)))
            for x in 0..<width {
                let lowX = (Double(x) + 0.5) * Double(lowWidth) / Double(width) - 0.5
                let x0 = max(0, min(lowWidth - 1, Int(floor(lowX))))
                let x1 = min(lowWidth - 1, x0 + 1)
                let fx = max(0, min(1, lowX - Double(x0)))
                let a = logits[[0, candidate, y0, x0] as [NSNumber]].doubleValue
                let b = logits[[0, candidate, y0, x1] as [NSNumber]].doubleValue
                let c = logits[[0, candidate, y1, x0] as [NSNumber]].doubleValue
                let d = logits[[0, candidate, y1, x1] as [NSNumber]].doubleValue
                let top = a + (b - a) * fx
                let bottom = c + (d - c) * fx
                if top + (bottom - top) * fy > 0 { pixels[y * width + x] = 255; area += 1 }
            }
        }
        return (pixels, area)
    }

    static func save(_ pixels: [UInt8], _ width: Int, _ height: Int, _ url: URL) throws {
        guard let provider = CGDataProvider(data: Data(pixels) as CFData),
              let image = CGImage(width: width, height: height, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: width,
                                  space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                                  provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent),
              let destination = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)
        else { throw NSError(domain: "PhotoSam", code: 6) }
        CGImageDestinationAddImage(destination, image, nil)
        guard CGImageDestinationFinalize(destination) else { throw NSError(domain: "PhotoSam", code: 7) }
    }
}
