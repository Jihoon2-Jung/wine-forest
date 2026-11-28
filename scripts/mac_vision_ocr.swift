import Foundation
import Vision
import ImageIO

struct OcrLine: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let w: Double
    let h: Double
}

struct OcrImageResult: Codable {
    let path: String
    let lines: [OcrLine]
    let error: String?
}

func loadImagePaths(args: [String]) throws -> [String] {
    var paths: [String] = []
    var idx = 1
    while idx < args.count {
        let arg = args[idx]
        if arg == "--manifest" {
            guard idx + 1 < args.count else {
                throw NSError(domain: "MacVisionOCR", code: 1, userInfo: [
                    NSLocalizedDescriptionKey: "Missing file path after --manifest"
                ])
            }
            let manifestURL = URL(fileURLWithPath: args[idx + 1])
            let data = try Data(contentsOf: manifestURL)
            let decoded = try JSONDecoder().decode([String].self, from: data)
            paths.append(contentsOf: decoded)
            idx += 2
        } else {
            paths.append(arg)
            idx += 1
        }
    }
    return paths
}

func recognizeText(at path: String) -> OcrImageResult {
    let url = URL(fileURLWithPath: path)
    guard let src = CGImageSourceCreateWithURL(url as CFURL, nil),
          let cgImage = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
        return OcrImageResult(path: path, lines: [], error: "Failed to decode image at path")
    }

    var lines: [OcrLine] = []
    var requestError: Error?

    let request = VNRecognizeTextRequest { req, err in
        if let err = err {
            requestError = err
            return
        }
        guard let observations = req.results as? [VNRecognizedTextObservation] else { return }
        for obs in observations {
            guard let top = obs.topCandidates(1).first else { continue }
            let box = obs.boundingBox
            let topY = max(0.0, min(1.0, 1.0 - Double(box.origin.y) - Double(box.size.height)))
            lines.append(
                OcrLine(
                    text: top.string,
                    confidence: top.confidence,
                    x: Double(box.origin.x),
                    y: topY,
                    w: Double(box.size.width),
                    h: Double(box.size.height)
                )
            )
        }
    }

    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    request.recognitionLanguages = ["fr-FR", "en-US", "it-IT", "de-DE", "es-ES", "ko-KR"]

    let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
    do {
        try handler.perform([request])
    } catch {
        return OcrImageResult(path: path, lines: [], error: error.localizedDescription)
    }

    if let requestError = requestError {
        return OcrImageResult(path: path, lines: [], error: requestError.localizedDescription)
    }

    lines.sort { lhs, rhs in
        if abs(lhs.y - rhs.y) > 0.015 {
            return lhs.y < rhs.y
        }
        return lhs.x < rhs.x
    }

    return OcrImageResult(path: path, lines: lines, error: nil)
}

do {
    let paths = try loadImagePaths(args: CommandLine.arguments)
    let results = paths.map { recognizeText(at: $0) }
    let encoder = JSONEncoder()
    let data = try encoder.encode(results)
    if let jsonStr = String(data: data, encoding: .utf8) {
        print(jsonStr)
    } else {
        fputs("Failed to encode OCR JSON output\n", stderr)
        exit(1)
    }
} catch {
    fputs("MacVisionOCR error: \(error.localizedDescription)\n", stderr)
    exit(1)
}
