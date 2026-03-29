import Foundation
import CoreGraphics

// CGWindowListCopyWindowInfo returns info about every window currently on screen.
// We filter to only "normal" windows (layer 0) that have a non-empty title.
let options: CGWindowListOption = [.optionOnScreenOnly, .excludeDesktopElements]
let windowList = CGWindowListCopyWindowInfo(options, kCGNullWindowID) as? [[String: Any]] ?? []

var windows: [[String: Any]] = []

for window in windowList {
    guard
        let layer = window[kCGWindowLayer as String] as? Int, layer == 0,
        let pid = window[kCGWindowOwnerPID as String] as? Int32,
        let appName = window[kCGWindowOwnerName as String] as? String,
        let title = window[kCGWindowName as String] as? String,
        !title.isEmpty,
        appName != "Relay"         // exclude our own app
    else { continue }

    windows.append(["pid": pid, "title": title, "app": appName])
}

if let json = try? JSONSerialization.data(withJSONObject: windows),
   let str = String(data: json, encoding: .utf8) {
    print(str)
}
