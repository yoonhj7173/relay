import Foundation
import AppKit

// Accepts a PID and reads all text from that app via Accessibility API.
guard CommandLine.arguments.count > 1, let pid = pid_t(CommandLine.arguments[1]) else {
    fputs("Usage: read-window <pid>\n", stderr)
    exit(1)
}

let appElement = AXUIElementCreateApplication(pid)

func extractText(_ element: AXUIElement, depth: Int = 0) -> [String] {
    guard depth < 25 else { return [] }
    var texts: [String] = []

    var value: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXValueAttribute as CFString, &value) == .success,
       let text = value as? String,
       !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        texts.append(text)
    }

    var children: AnyObject?
    if AXUIElementCopyAttributeValue(element, kAXChildrenAttribute as CFString, &children) == .success,
       let childArray = children as? [AXUIElement] {
        for child in childArray {
            texts.append(contentsOf: extractText(child, depth: depth + 1))
        }
    }

    return texts
}

let texts = extractText(appElement)
print(texts.joined(separator: "\n"))
