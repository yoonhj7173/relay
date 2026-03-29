import Foundation
import AppKit
import CoreGraphics

// Accepts a desktopCapturer source ID like "window:12345:0"
// Extracts the CGWindowID, looks up the PID, then reads text via Accessibility API.
guard CommandLine.arguments.count > 1 else {
    fputs("Usage: read-window <source-id>\n", stderr)
    exit(1)
}

let sourceId = CommandLine.arguments[1]
let parts = sourceId.split(separator: ":")

guard parts.count >= 2, let windowNum = UInt32(parts[1]) else {
    fputs("Invalid source ID: \(sourceId)\n", stderr)
    exit(1)
}

let cgWindowId = CGWindowID(windowNum)

// Look up PID from the CGWindowID
let windowInfo = CGWindowListCopyWindowInfo([.optionIncludingWindow], cgWindowId) as? [[String: Any]]
guard let pid = windowInfo?.first?[kCGWindowOwnerPID as String] as? pid_t else {
    fputs("Could not find PID for window \(cgWindowId)\n", stderr)
    exit(1)
}

// Walk the accessibility tree and collect all text
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
