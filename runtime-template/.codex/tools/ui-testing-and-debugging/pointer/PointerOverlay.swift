// Native click-through desktop halo and Computer Use frame renderer.
// Mouse position/button state only; no keyboard events are monitored or stored.
import AppKit
import CoreGraphics

let blue = NSColor(srgbRed: 0, green: 140.0 / 255, blue: 1, alpha: 1)

func drawPointer(at p: NSPoint, phase: String, progress: Double = 0.25) {
    let glow = NSGradient(colors: [blue.withAlphaComponent(0.60), blue.withAlphaComponent(0.22), blue.withAlphaComponent(0)])!
    glow.draw(fromCenter: p, radius: 6, toCenter: p, radius: 44, options: [])
    blue.withAlphaComponent(0.95).setStroke()
    let halo = NSBezierPath(ovalIn: NSRect(x: p.x - 22, y: p.y - 22, width: 44, height: 44))
    halo.lineWidth = 3
    halo.stroke()
    if phase != "idle" {
        for offset in [0.0, 12.0] {
            let radius = 26 + progress * 34 + offset
            let ring = NSBezierPath(ovalIn: NSRect(x: p.x - radius, y: p.y - radius, width: radius * 2, height: radius * 2))
            blue.withAlphaComponent(max(0, 1 - progress) * 0.9).setStroke()
            ring.lineWidth = phase == "keyboard" ? 4 : 3
            ring.stroke()
        }
    }
    // Tip marks the exact click coordinate. The glow does not change hit testing.
    let arrow = NSBezierPath()
    arrow.move(to: p)
    arrow.line(to: NSPoint(x: p.x + 2, y: p.y - 25))
    arrow.line(to: NSPoint(x: p.x + 8, y: p.y - 19))
    arrow.line(to: NSPoint(x: p.x + 14, y: p.y - 30))
    arrow.line(to: NSPoint(x: p.x + 19, y: p.y - 27))
    arrow.line(to: NSPoint(x: p.x + 13, y: p.y - 16))
    arrow.line(to: NSPoint(x: p.x + 23, y: p.y - 15))
    arrow.close()
    arrow.lineJoinStyle = .round
    blue.setStroke()
    arrow.lineWidth = 5
    arrow.stroke()
    NSColor.white.setFill()
    arrow.fill()
}

func renderFrame(input: String, output: String, x: Double, y: Double, phase: String) throws {
    guard x.isFinite, y.isFinite, let image = NSImage(contentsOfFile: input),
          let source = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
        throw NSError(domain: "PointerOverlay", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid source image or coordinates"])
    }
    let width = source.width, height = source.height
    guard x >= 0, y >= 0, x < Double(width), y < Double(height),
          let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
          let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw NSError(domain: "PointerOverlay", code: 2, userInfo: [NSLocalizedDescriptionKey: "Target is outside the captured image"])
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = context
    context.cgContext.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
    drawPointer(at: NSPoint(x: x, y: Double(height) - y), phase: phase)
    NSGraphicsContext.restoreGraphicsState()
    guard let data = bitmap.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "PointerOverlay", code: 3)
    }
    try data.write(to: URL(fileURLWithPath: output), options: .atomic)
}

final class HaloView: NSView {
    var phase = "idle"
    var progress = 0.0
    override func draw(_ dirtyRect: NSRect) {
        drawPointer(at: NSPoint(x: bounds.midX, y: bounds.midY), phase: phase, progress: progress)
    }
}

final class HaloPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

final class DesktopOverlay: NSObject, NSApplicationDelegate {
    let panel = HaloPanel(contentRect: NSRect(x: 0, y: 0, width: 180, height: 180), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    let halo = HaloView(frame: NSRect(x: 0, y: 0, width: 180, height: 180))
    var timer: Timer?
    var status: NSStatusItem?
    var previousButtons = NSEvent.pressedMouseButtons
    var clickedAt = -Double.infinity
    var lastPoint = NSPoint(x: -10000, y: -10000)
    var paused = false

    func applicationDidFinishLaunching(_ notification: Notification) {
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
        panel.sharingType = .readOnly
        panel.contentView = halo
        panel.orderFrontRegardless()
        status = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        status?.button?.title = "◉"
        status?.button?.contentTintColor = blue
        status?.button?.toolTip = "Blue pointer highlight"
        let menu = NSMenu()
        let pauseItem = NSMenuItem(title: "Pause / resume highlight", action: #selector(toggle), keyEquivalent: "")
        pauseItem.target = self
        menu.addItem(pauseItem)
        let quitItem = NSMenuItem(title: "Quit blue pointer", action: #selector(quit), keyEquivalent: "")
        quitItem.target = self
        menu.addItem(quitItem)
        status?.menu = menu
        timer = Timer(timeInterval: 1.0 / 30, repeats: true) { [weak self] _ in self?.refresh() }
        RunLoop.main.add(timer!, forMode: .common)
        refresh()
        print("Blue pointer ready; click-through desktop overlay; quit from its menu or pointer.mjs off")
        fflush(stdout)
    }

    func refresh() {
        let point = NSEvent.mouseLocation
        let buttons = NSEvent.pressedMouseButtons
        let now = ProcessInfo.processInfo.systemUptime
        if buttons & ~previousButtons != 0 { clickedAt = now }
        previousButtons = buttons
        guard !paused else { return }
        if point != lastPoint {
            panel.setFrameOrigin(NSPoint(x: point.x - 90, y: point.y - 90))
            lastPoint = point
        }
        let elapsed = now - clickedAt
        let phase = elapsed < 0.9 ? "click" : "idle"
        if halo.phase != phase || phase == "click" {
            halo.phase = phase
            halo.progress = min(1, elapsed / 0.9)
            halo.needsDisplay = true
        }
    }

    @objc func toggle() {
        paused.toggle()
        if paused { panel.orderOut(nil) } else { panel.orderFrontRegardless(); refresh() }
    }

    @objc func quit() {
        let disabled = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent().appendingPathComponent("disabled")
        do { try Data("disabled\n".utf8).write(to: disabled, options: .atomic) }
        catch { fputs("Could not disable enhanced frames; use pointer.mjs off.\n", stderr) }
        NSApplication.shared.terminate(nil)
    }

    func applicationWillTerminate(_ notification: Notification) {
        timer?.invalidate()
        panel.orderOut(nil)
        if let status { NSStatusBar.system.removeStatusItem(status) }
    }
}

let args = Array(CommandLine.arguments.dropFirst())
if args.first == "render", args.count == 7, let x = Double(args[3]), let y = Double(args[4]), ["idle", "click", "keyboard"].contains(args[5]), args[6] == "--png" {
    do { try renderFrame(input: args[1], output: args[2], x: x, y: y, phase: args[5]) }
    catch { fputs("Pointer rendering failed: \(error.localizedDescription)\n", stderr); exit(1) }
} else if args == ["desktop"] {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    let delegate = DesktopOverlay()
    app.delegate = delegate
    app.run()
    withExtendedLifetime(delegate) {}
} else {
    fputs("Usage: PointerOverlay desktop | render INPUT OUTPUT X Y idle|click|keyboard --png\n", stderr)
    exit(1)
}
