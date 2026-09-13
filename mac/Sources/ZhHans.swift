// Traditional → Simplified using OpenCC's TSCharacters table.
// Whisper often emits Taiwan/HK forms (製作、費用) even for mainland speech.

import Foundation

enum ZhHans {
    static func convert(_ text: String) -> String {
        guard text.contains(where: isHan) else { return text }
        let map = table
        var out = String()
        out.reserveCapacity(text.count)
        for character in text {
            out.append(map[character] ?? character)
        }
        return out
    }

    private static let table: [Character: Character] = {
        let urls = [
            Bundle.main.url(forResource: "TSCharacters", withExtension: "txt"),
            URL(fileURLWithPath: "\(ServerRecord.directory.path)/TSCharacters.txt"),
        ].compactMap { $0 }
        for url in urls {
            if let parsed = load(url), !parsed.isEmpty { return parsed }
        }
        return [:]
    }()

    private static func load(_ url: URL) -> [Character: Character]? {
        guard let raw = try? String(contentsOf: url, encoding: .utf8) else { return nil }
        var map: [Character: Character] = [:]
        for line in raw.split(whereSeparator: \.isNewline) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
            let parts = trimmed.split(whereSeparator: \.isWhitespace)
            guard parts.count >= 2, let from = parts[0].first, let to = parts[1].first else { continue }
            if map[from] == nil { map[from] = to }
        }
        return map
    }

    private static func isHan(_ character: Character) -> Bool {
        character.unicodeScalars.contains { (0x4E00 ... 0x9FFF).contains($0.value) }
    }
}
