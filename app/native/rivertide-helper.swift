// rivertide-helper: Rivertide's native macOS companion process.
//
// Speaks newline-delimited JSON over stdin/stdout (docs/ARCHITECTURE.md §3.7):
//   - reports fn (Globe) key transitions plus modifier state from a listen-only CGEventTap
//   - answers commands: ping, frontmostApp, paste, typeText, focusedText, mediaKey, checkAccess
// It exits with code 0 when stdin closes, so it can never outlive the Electron app.
// Build with app/scripts/build-native.sh (Swift 5 language mode; see that script).

import ApplicationServices
import Cocoa

// MARK: - Constants

let protocolVersion = 1
let maxTextLength = 4000                           // focusedText truncation, in characters
let tapRetryInterval: TimeInterval = 5             // seconds between event-tap creation attempts
let activationDelayMicros: useconds_t = 120_000    // let the window server move key focus
let typeChunkLimit = 20                            // UTF-16 units per synthetic keystroke
let typeChunkDelayMicros: useconds_t = 4_000       // pause between keystrokes so apps keep up
let axMessagingTimeout: Float = 1.0                // seconds; a hung app must not block us
let virtualKeyV: CGKeyCode = 9                     // kVK_ANSI_V
let mediaKeySubtype: Int16 = 8                     // NX_SUBTYPE_AUX_CONTROL_BUTTONS
let mediaKeyDown = 0xA                             // NX_KEYDOWN
let mediaKeyUp = 0xB                               // NX_KEYUP

/// NX_KEYTYPE_* codes from IOKit/hidsystem/ev_keymap.h.
let mediaKeyCodes: [String: Int] = [
    "playpause": 16, "next": 17, "previous": 18, "mute": 7, "volumeUp": 0, "volumeDown": 1,
]

/// Key codes of modifier keys other than fn (command, shift, caps lock, option, control; left and
/// right). Their flagsChanged events can carry a stale secondaryFn bit (e.g. while an arrow key is
/// held), so they may end an fn press but never start one.
let nonFnModifierKeyCodes: Set<Int64> = [54, 55, 56, 57, 58, 59, 60, 61, 62]

// MARK: - Output (every stdout write goes through one serial queue)

let outputQueue = DispatchQueue(label: "org.codethecure.rivertide.helper.stdout")

func emit(_ message: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(message),
          let json = try? JSONSerialization.data(withJSONObject: message, options: [.withoutEscapingSlashes])
    else {
        FileHandle.standardError.write(Data("rivertide-helper: dropped unserializable message\n".utf8))
        return
    }
    outputQueue.async {
        do {
            try FileHandle.standardOutput.write(contentsOf: json + Data([0x0A]))
        } catch {
            exit(0) // The app closed our stdout: nobody is listening any more.
        }
    }
}

func emitLog(_ level: String, _ message: String) {
    emit(["type": "log", "level": level, "message": message])
}

/// Returns `message` with the request id attached (when the request carried one).
func tagged(_ message: [String: Any], id: Any?) -> [String: Any] {
    guard let id else { return message }
    return message.merging(["id": id]) { _, new in new }
}

// MARK: - fn key monitoring

/// Owns the listen-only event tap. It lives for the whole process (the global `keyMonitor`) and is
/// handed to the C callback as an unretained `userInfo` pointer, so the callback can re-enable the
/// tap after the system disables it.
final class KeyMonitor {
    private var tap: CFMachPort?
    private var isFnDown = false
    private var retryTimer: Timer?

    /// Creates the tap now, or retries every few seconds until permission is granted. Never exits:
    /// granting Accessibility / Input Monitoring later must work without restarting the helper.
    func start() {
        guard !installTap() else { return }
        emitLog("warn", "cannot create event tap (grant Accessibility / Input Monitoring); retrying every \(Int(tapRetryInterval)) s")
        retryTimer = Timer.scheduledTimer(withTimeInterval: tapRetryInterval, repeats: true) { [weak self] timer in
            guard let self, self.installTap() else { return }
            timer.invalidate()
            self.retryTimer = nil
            emitLog("info", "event tap created")
        }
    }

    private func installTap() -> Bool {
        guard let port = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: CGEventMask(1 << CGEventType.flagsChanged.rawValue),
            callback: keyTapCallback,
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        ) else { return false }
        let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, port, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
        CGEvent.tapEnable(tap: port, enable: true)
        tap = port
        return true
    }

    /// Runs on the main run loop for every tapped event.
    func handle(type: CGEventType, event: CGEvent) {
        switch type {
        case .tapDisabledByTimeout:
            reenable(reason: "timeout")
        case .tapDisabledByUserInput:
            reenable(reason: "user input")
        case .flagsChanged:
            let keyCode = event.getIntegerValueField(.keyboardEventKeycode)
            let hasFn = event.flags.contains(.maskSecondaryFn)
            update(isFnDown: hasFn && (isFnDown || !nonFnModifierKeyCodes.contains(keyCode)), flags: event.flags)
        default:
            break
        }
    }

    private func reenable(reason: String) {
        guard let tap else { return }
        CGEvent.tapEnable(tap: tap, enable: true)
        emitLog("warn", "event tap re-enabled after \(reason)")
        // An fn release may have been missed while the tap was off; resynchronise from live state.
        let flags = CGEventSource.flagsState(.combinedSessionState)
        if isFnDown && !flags.contains(.maskSecondaryFn) {
            update(isFnDown: false, flags: flags)
        }
    }

    private func update(isFnDown next: Bool, flags: CGEventFlags) {
        guard next != isFnDown else { return } // de-duplicate: only real transitions are reported
        isFnDown = next
        emit([
            "type": "key",
            "key": "fn",
            "down": next,
            "mods": [
                "ctrl": flags.contains(.maskControl),
                "shift": flags.contains(.maskShift),
                "alt": flags.contains(.maskAlternate),
                "cmd": flags.contains(.maskCommand),
            ],
            "t": Int((ProcessInfo.processInfo.systemUptime * 1000).rounded()), // ms since boot
        ])
    }
}

/// C-compatible tap callback. It cannot capture context, so the monitor arrives via `userInfo`.
func keyTapCallback(
    proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, userInfo: UnsafeMutableRawPointer?
) -> Unmanaged<CGEvent>? {
    if let userInfo {
        Unmanaged<KeyMonitor>.fromOpaque(userInfo).takeUnretainedValue().handle(type: type, event: event)
    }
    // A listen-only tap passes the event through untouched. passUnretained: we never own it.
    return Unmanaged.passUnretained(event)
}

// MARK: - Commands

struct CommandError: Error {
    let message: String
}

func requireAccessibility() throws {
    guard AXIsProcessTrusted() else { throw CommandError(message: "accessibility-missing") }
}

/// Runs `work` on the main thread, where AppKit keeps state such as the frontmost app current.
func onMain<T>(_ work: () -> T) -> T {
    Thread.isMainThread ? work() : DispatchQueue.main.sync(execute: work)
}

func runCommand(_ cmd: String, _ message: [String: Any]) throws -> [String: Any] {
    switch cmd {
    case "ping": return ["pong": true]
    case "frontmostApp": return try frontmostApp()
    case "paste": return try paste(bundleId: message["bundleId"] as? String)
    case "typeText": return try typeText(message["text"])
    case "focusedText": return try focusedText()
    case "mediaKey": return try mediaKey(message["key"])
    case "checkAccess": return ["accessibility": AXIsProcessTrusted()]
    default: throw CommandError(message: "unknown command: \(cmd)")
    }
}

func frontmostApp() throws -> [String: Any] {
    let info: [String: Any]? = onMain {
        guard let app = NSWorkspace.shared.frontmostApplication else { return nil }
        return [
            "name": app.localizedName ?? "",
            "bundleId": app.bundleIdentifier ?? "",
            "pid": Int(app.processIdentifier),
        ]
    }
    guard let info else { throw CommandError(message: "no frontmost application") }
    return info
}

func paste(bundleId: String?) throws -> [String: Any] {
    try requireAccessibility()
    if let bundleId, !bundleId.isEmpty, activateIfInBackground(bundleId: bundleId) {
        usleep(activationDelayMicros)
    }
    try postKeystroke(virtualKeyV, flags: .maskCommand)
    return [:]
}

/// Activates the app if it is running but not frontmost. Returns true when activation was requested.
func activateIfInBackground(bundleId: String) -> Bool {
    onMain {
        guard let target = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId).first
        else { return false }
        let front = NSWorkspace.shared.frontmostApplication
        guard front?.processIdentifier != target.processIdentifier else { return false }
        // macOS 14+ uses cooperative activation: borrow the active app's activation context.
        if #available(macOS 14.0, *), let front, target.activate(from: front, options: []) {
            return true
        }
        return target.activate(options: [.activateIgnoringOtherApps])
    }
}

/// Posts a key down/up pair with exactly `flags`, so physically held keys (fn, ctrl) don't leak in.
func postKeystroke(_ key: CGKeyCode, flags: CGEventFlags) throws {
    let source = CGEventSource(stateID: .hidSystemState)
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: key, keyDown: false)
    else { throw CommandError(message: "could not create keyboard event") }
    down.flags = flags
    up.flags = flags
    down.post(tap: .cghidEventTap)
    up.post(tap: .cghidEventTap)
}

func typeText(_ value: Any?) throws -> [String: Any] {
    guard let text = value as? String else {
        throw CommandError(message: "typeText requires a string \"text\"")
    }
    try requireAccessibility()
    let source = CGEventSource(stateID: .hidSystemState)
    for chunk in typingChunks(text, limit: typeChunkLimit) {
        try postUnicode(chunk, source: source)
        usleep(typeChunkDelayMicros)
    }
    return [:]
}

/// Splits text into chunks of at most `limit` UTF-16 units. Chunks break between grapheme clusters
/// (and, for a cluster longer than `limit`, between scalars) so no character is cut in half.
func typingChunks(_ text: String, limit: Int) -> [[UniChar]] {
    let pieces: [[UniChar]] = text.flatMap { character -> [[UniChar]] in
        let units = Array(String(character).utf16)
        return units.count <= limit ? [units] : character.unicodeScalars.map { Array(String($0).utf16) }
    }
    return pieces.reduce(into: [[UniChar]]()) { chunks, piece in
        if let last = chunks.last, last.count + piece.count <= limit {
            chunks[chunks.count - 1] = last + piece
        } else {
            chunks.append(piece)
        }
    }
}

func postUnicode(_ units: [UniChar], source: CGEventSource?) throws {
    guard let down = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: true),
          let up = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: false)
    else { throw CommandError(message: "could not create keyboard event") }
    for event in [down, up] {
        event.flags = [] // never inherit modifiers the user is still holding
        event.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
        event.post(tap: .cghidEventTap)
    }
}

func focusedText() throws -> [String: Any] {
    try requireAccessibility()
    let empty: [String: Any] = ["role": "", "value": "", "selectedText": ""]
    guard let focused = axElement(AXUIElementCreateSystemWide(), kAXFocusedUIElementAttribute) else {
        return empty
    }
    let role = axString(focused, kAXRoleAttribute)
    // Password fields: report the role only, never their contents.
    let isSecure = role == kAXSecureTextFieldSubrole || axString(focused, kAXSubroleAttribute) == kAXSecureTextFieldSubrole
    guard !isSecure else { return empty.merging(["role": role]) { _, new in new } }
    return [
        "role": role,
        "value": String(axString(focused, kAXValueAttribute).prefix(maxTextLength)),
        "selectedText": String(axString(focused, kAXSelectedTextAttribute).prefix(maxTextLength)),
    ]
}

func axElement(_ element: AXUIElement, _ attribute: String) -> AXUIElement? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success,
          let value, CFGetTypeID(value) == AXUIElementGetTypeID()
    else { return nil }
    return (value as! AXUIElement) // safe: the CF type id was checked above
}

/// Reads a string attribute; missing or non-string attributes become "".
func axString(_ element: AXUIElement, _ attribute: String) -> String {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute as CFString, &value) == .success else { return "" }
    return (value as? String) ?? ""
}

func mediaKey(_ value: Any?) throws -> [String: Any] {
    guard let name = value as? String, let code = mediaKeyCodes[name] else {
        throw CommandError(message: "mediaKey requires key: \(mediaKeyCodes.keys.sorted().joined(separator: "|"))")
    }
    try requireAccessibility()
    for state in [mediaKeyDown, mediaKeyUp] {
        guard let event = NSEvent.otherEvent(
            with: .systemDefined,
            location: .zero,
            modifierFlags: NSEvent.ModifierFlags(rawValue: UInt(state << 8)),
            timestamp: 0,
            windowNumber: 0,
            context: nil,
            subtype: mediaKeySubtype,
            data1: (code << 16) | (state << 8),
            data2: -1
        ), let cgEvent = event.cgEvent else {
            throw CommandError(message: "could not create media key event")
        }
        cgEvent.post(tap: .cghidEventTap)
    }
    return [:]
}

// MARK: - Request loop

func handleLine(_ line: String) {
    let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    guard let object = try? JSONSerialization.jsonObject(with: Data(trimmed.utf8)),
          let message = object as? [String: Any]
    else {
        emit(["type": "error", "message": "malformed JSON line"])
        return
    }
    let id: Any? = message["id"].flatMap { ($0 is String || $0 is NSNumber) ? $0 : nil }
    guard let cmd = message["cmd"] as? String else {
        emit(tagged(["type": "error", "message": "missing \"cmd\""], id: id))
        return
    }
    do {
        let data = try runCommand(cmd, message)
        emit(tagged(["type": "result", "ok": true, "data": data], id: id))
    } catch {
        let reason = (error as? CommandError)?.message ?? String(describing: error)
        emit(tagged(["type": "error", "message": reason], id: id))
    }
}

// MARK: - Main

signal(SIGPIPE, SIG_IGN) // a closed stdout becomes a write error (handled in emit), not a crash
AXUIElementSetMessagingTimeout(AXUIElementCreateSystemWide(), axMessagingTimeout) // global AX timeout
emit(["type": "ready", "version": protocolVersion, "accessibility": AXIsProcessTrusted()])

let keyMonitor = KeyMonitor()
keyMonitor.start()

// Commands run one at a time on this background thread, so a slow command (typeText, AX reads)
// never stalls the event tap on the main run loop.
Thread.detachNewThread {
    while let line = readLine(strippingNewline: true) {
        handleLine(line)
    }
    // EOF: the app is gone or closed our stdin. Flush queued output, then exit cleanly.
    outputQueue.sync {}
    exit(0)
}

CFRunLoopRun()
