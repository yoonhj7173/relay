import Foundation
import CoreGraphics

// Returns list of unique running apps with their PIDs.
// Requires Screen Recording permission to see window titles.
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []

var seen = Set<String>()
var apps: [[String: Any]] = []

for window in windowList {
    guard
        let layer = window[kCGWindowLayer as String] as? Int, layer == 0,
        let pid = window[kCGWindowOwnerPID as String] as? Int32,
        let appName = window[kCGWindowOwnerName as String] as? String,
        !appName.isEmpty,
        appName != "Relay",
        appName != "Electron",
        !seen.contains(appName)
    else { continue }

    seen.insert(appName)
    apps.append(["pid": pid, "app": appName])
}

if let json = try? JSONSerialization.data(withJSONObject: apps),
   let str = String(data: json, encoding: .utf8) {
    print(str)
}
