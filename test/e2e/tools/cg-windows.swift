// Prints, as JSON, the Core Graphics window list for one process: `cg-windows <pid>`.
// macOS keeps the background tabs of a native tab group off screen, so `onScreen` shows tab membership.
import CoreGraphics
import Foundation

guard CommandLine.arguments.count == 2, let pid = Int(CommandLine.arguments[1]) else {
  FileHandle.standardError.write("usage: cg-windows <pid>\n".data(using: .utf8)!)
  exit(2)
}

let list = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
let windows: [[String: Any]] = list
  .filter { ($0[kCGWindowOwnerPID as String] as? Int) == pid }
  .map { info in
    [
      "number": info[kCGWindowNumber as String] as? Int ?? -1,
      "layer": info[kCGWindowLayer as String] as? Int ?? -1,
      "onScreen": info[kCGWindowIsOnscreen as String] as? Bool ?? false,
      "bounds": info[kCGWindowBounds as String] ?? [:],
      "name": info[kCGWindowName as String] as? String ?? NSNull(),
    ]
  }
let data = try JSONSerialization.data(withJSONObject: windows, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
