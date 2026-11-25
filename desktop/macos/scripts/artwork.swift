import AppKit

func savePNG(_ image: NSImage, _ url: URL) throws {
    guard let tiff = image.tiffRepresentation,
          let bitmap = NSBitmapImageRep(data: tiff),
          let png = bitmap.representation(using: .png, properties: [:]) else {
        throw CocoaError(.fileWriteUnknown)
    }
    try png.write(to: url)
}

let build = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
guard let source = NSImage(contentsOf: build.appendingPathComponent("uni-icon.svg")) else {
    throw CocoaError(.fileReadCorruptFile)
}
let icon = NSImage(size: NSSize(width: 1024, height: 1024), flipped: false) { _ in
    NSColor.clear.setFill()
    NSBezierPath(rect: NSRect(x: 0, y: 0, width: 1024, height: 1024)).fill()
    source.draw(in: NSRect(x: 72, y: 72, width: 880, height: 880),
                from: .zero, operation: .sourceOver, fraction: 1,
                respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high.rawValue])
    return true
}
try savePNG(icon, build.appendingPathComponent("Uni-1024.png"))

let background = NSImage(size: NSSize(width: 660, height: 430), flipped: true) { bounds in
    let colors = [
        NSColor(red: 0.065, green: 0.14, blue: 0.28, alpha: 1),
        NSColor(red: 0.12, green: 0.28, blue: 0.42, alpha: 1),
        NSColor(red: 0.12, green: 0.42, blue: 0.44, alpha: 1)
    ]
    NSGradient(colors: colors)?.draw(in: bounds, angle: 30)
    let orbit = NSBezierPath()
    orbit.move(to: NSPoint(x: -40, y: 360))
    orbit.curve(to: NSPoint(x: 710, y: 50), controlPoint1: NSPoint(x: 245, y: 465), controlPoint2: NSPoint(x: 420, y: -70))
    NSColor(calibratedWhite: 1, alpha: 0.11).setStroke()
    orbit.lineWidth = 44
    orbit.stroke()
    func centered(_ text: String, at y: CGFloat, size: CGFloat, weight: NSFont.Weight, opacity: CGFloat) {
        let attrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: size, weight: weight),
            .foregroundColor: NSColor(calibratedWhite: 1, alpha: opacity)
        ]
        let value = NSAttributedString(string: text, attributes: attrs)
        value.draw(at: NSPoint(x: (bounds.width - value.size().width) / 2, y: y))
    }
    centered("Napa Valley", at: 43, size: 38, weight: .semibold, opacity: 1)
    centered("Uni for macOS", at: 96, size: 16, weight: .medium, opacity: 0.82)
    centered("→", at: 206, size: 44, weight: .light, opacity: 0.8)
    centered("Drag Uni to Applications", at: 348, size: 14, weight: .medium, opacity: 0.88)
    return true
}
try savePNG(background, build.appendingPathComponent("dmg-background.png"))
