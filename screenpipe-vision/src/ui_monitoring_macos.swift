import Cocoa
import ApplicationServices
import Foundation
import SQLite3

// Define WindowState struct first
struct WindowState {
    var elements: [AXUIElementWrapper: ElementAttributes]
    var textOutput: String

    init() {
        self.elements = [:]
        self.textOutput = ""
    }
}

// Global state
var globalElementValues = [String: [String: WindowState]]()  // [App: [Window: WindowState]]
var currentObserver: AXObserver? {
    willSet {
        if let observer = currentObserver {
            CFRunLoopRemoveSource(
                CFRunLoopGetCurrent(),
                AXObserverGetRunLoopSource(observer),
                .defaultMode
            )
        }
    }
}
var monitoringEventLoop: CFRunLoop?
var hasChanges = false

// Add global context structure
class MonitoringContext {
    let appName: String
    let windowName: String

    init(appName: String, windowName: String) {
        self.appName = appName
        self.windowName = windowName
    }
}
var currentContext: MonitoringContext?

// Add these custom notification constants at the top of the file
let kAXScrolledVisibleChangedNotification = "AXScrolledVisibleChanged" as CFString
let kAXSelectedCellsChangedNotification = "AXSelectedCellsChanged" as CFString
let kAXLayoutChangedNotification = "AXLayoutChanged" as CFString

// Update notificationsToObserve array
let notificationsToObserve: [(String, String)] = [
    ("AXValueChanged", kAXValueChangedNotification as String),
    ("AXTitleChanged", kAXTitleChangedNotification as String),
    ("AXFocusedUIElementChanged", kAXFocusedUIElementChangedNotification as String),
    ("AXFocusedWindowChanged", kAXFocusedWindowChangedNotification as String),
    ("AXMainWindowChanged", kAXMainWindowChangedNotification as String),
    ("AXSelectedTextChanged", kAXSelectedTextChangedNotification as String),
    ("AXUIElementDestroyed", kAXUIElementDestroyedNotification as String),
    ("AXSelectedChildrenChanged", kAXSelectedChildrenChangedNotification as String),
    ("AXRowCountChanged", kAXRowCountChangedNotification as String),
    ("AXSelectedRowsChanged", kAXSelectedRowsChangedNotification as String),
    ("AXScrolledVisibleChanged", kAXScrolledVisibleChangedNotification as String),
    ("AXLayoutChanged", kAXLayoutChangedNotification as String),
    ("AXSelectedCellsChanged", kAXSelectedCellsChangedNotification as String),
    ("AXWindowResized", kAXWindowResizedNotification as String),
    ("AXWindowMoved", kAXWindowMovedNotification as String),
    ("AXCreated", kAXCreatedNotification as String)
]

// Struct to hold element attributes including hierarchy and position
struct ElementAttributes {
    var element: String
    var path: String
    var attributes: [String: String]
    var depth: Int
    var x: CGFloat
    var y: CGFloat
    var width: CGFloat
    var height: CGFloat
    var children: [ElementAttributes]
}

// Add traversal state management
var isTraversing = false
var shouldCancelTraversal = false
let traversalQueue = DispatchQueue(label: "com.screenpipe.traversal")

// Add global database connection
var db: OpaquePointer?

// Replace the tuple with a struct
struct WindowIdentifier: Hashable {
    let app: String
    let window: String
}

// Change the set declaration
var changedWindows = Set<WindowIdentifier>()

// Add synchronization queue and cleanup flag
let synchronizationQueue = DispatchQueue(label: "com.screenpipe.synchronization")
var isCleaningUp = false

// Start monitoring
startMonitoring()

func startMonitoring() {
    // Set up signal handling
    signal(SIGINT) { _ in
        cleanup()
        exit(0)
    }

    setupDatabase()
    setupApplicationChangeObserver()
    monitorCurrentFrontmostApplication()

    Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
        autoreleasepool {
            saveElementValues()
        }
    }

    monitoringEventLoop = CFRunLoopGetCurrent()
    CFRunLoopRun()
}

func setupDatabase() {
    let dbPath = (FileManager.default.currentDirectoryPath as NSString).appendingPathComponent("ui_elements.db")

    if sqlite3_open(dbPath, &db) == SQLITE_OK {
        let createTableSQL = """
            CREATE TABLE IF NOT EXISTS ui_monitoring (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp TEXT,
                app TEXT,
                window TEXT,
                text_output TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_timestamp ON ui_monitoring(timestamp);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_app_window ON ui_monitoring(app, window);
        """

        if sqlite3_exec(db, createTableSQL, nil, nil, nil) != SQLITE_OK {
            print("error creating table: \(String(cString: sqlite3_errmsg(db!)))")
        }
    } else {
        print("error opening database")
    }
}

func monitorCurrentFrontmostApplication() {
    // Cancel any in-progress traversal
    if isTraversing {
        shouldCancelTraversal = true
        // Small delay to allow cancellation
        Thread.sleep(forTimeInterval: 0.1)
    }

    // Stop previous monitoring if any
    if let observer = currentObserver {
        CFRunLoopRemoveSource(
            CFRunLoopGetCurrent(),
            AXObserverGetRunLoopSource(observer),
            .defaultMode
        )
        currentObserver = nil
    }

    // Allow the run loop to process events
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.01))

    guard let app = NSWorkspace.shared.frontmostApplication else {
        print("no frontmost application found")
        return
    }

    let pid = app.processIdentifier
    let axApp = AXUIElementCreateApplication(pid)

    let appName = app.localizedName?.lowercased() ?? "unknown app"

    // Get window name BEFORE initializing structures
    var windowName = "unknown window"
    var windowValue: AnyObject?
    let result = AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &windowValue)
    if result == .success, let window = windowValue as! AXUIElement? {
        if let titleValue = getAttributeValue(window, forAttribute: kAXTitleAttribute) as? String {
            windowName = titleValue.lowercased()
        }
    }

    // Initialize app and window in the structure with correct window name
    if globalElementValues[appName] == nil {
        globalElementValues[appName] = [:]
    }
    if globalElementValues[appName]?[windowName] == nil {
        globalElementValues[appName]?[windowName] = WindowState()
    }

    // First do initial UI traverse with app and window context
    traverseAndStoreUIElements(axApp, appName: appName, windowName: windowName)
    hasChanges = true  // Ensure first scan gets saved

    // Then set up notifications
    setupAccessibilityNotifications(pid: pid, axApp: axApp, appName: appName, windowName: windowName)  // Pass context

    print("monitoring changes for \(app.localizedName?.lowercased() ?? "unknown app"), window: \(windowName.lowercased())...")
    print("press ctrl+c to stop")
}

func setupApplicationChangeObserver() {
    NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.didActivateApplicationNotification,
        object: nil,
        queue: OperationQueue.main
    ) { notification in
        // Application changed, start monitoring the new frontmost app
        monitorCurrentFrontmostApplication()
    }

    NSWorkspace.shared.notificationCenter.addObserver(
        forName: NSWorkspace.activeSpaceDidChangeNotification,
        object: nil,
        queue: OperationQueue.main
    ) { notification in
        // Space changed, update monitoring
        monitorCurrentFrontmostApplication()
    }
}

func traverseAndStoreUIElements(_ element: AXUIElement, appName: String, windowName: String) {
    // Don't start new traversal if one is already in progress
    if isTraversing { return }

    isTraversing = true
    shouldCancelTraversal = false

    // Reset the elements for the current window before traversal
    globalElementValues[appName]?[windowName]?.elements = [:]

    let startTime = DispatchTime.now()
    var visitedElements = Set<AXUIElementWrapper>()
    let unwantedValues = ["0", "", "3"]
    let unwantedLabels = [
        "window", "application", "group", "button", "image", "text",
        "pop up button", "region", "notifications", "table", "column",
        "html content"
    ]
    let attributesToCheck = ["AXDescription", "AXValue", "AXLabel", "AXRoleDescription", "AXHelp"]

    // Add totalCharacterCount variable to cap the traversed content at 1 million characters
    var totalCharacterCount = 0

    func traverse(_ element: AXUIElement, depth: Int) -> ElementAttributes? {
        // Check for cancellation
        if shouldCancelTraversal || totalCharacterCount >= 1_000_000 {
            if totalCharacterCount >= 1_000_000 {
                print("hit 1mln char limit for app: \(appName), window: \(windowName)")
            }
            return nil
        }

        let elementWrapper = AXUIElementWrapper(element: element)

        guard !visitedElements.contains(elementWrapper) else { return nil }
        visitedElements.insert(elementWrapper)

        var attributeNames: CFArray?
        let result = AXUIElementCopyAttributeNames(element, &attributeNames)

        guard result == .success, let attributes = attributeNames as? [String] else { return nil }

        var position: CGPoint = .zero
        var size: CGSize = .zero

        // Get position
        if let positionValue = getAttributeValue(element, forAttribute: kAXPositionAttribute) as! AXValue?,
           AXValueGetType(positionValue) == .cgPoint {
            AXValueGetValue(positionValue, .cgPoint, &position)
        }

        // Get size
        if let sizeValue = getAttributeValue(element, forAttribute: kAXSizeAttribute) as! AXValue?,
           AXValueGetType(sizeValue) == .cgSize {
            AXValueGetValue(sizeValue, .cgSize, &size)
        }

        // Get element description
        let elementDesc = (getAttributeValue(element, forAttribute: "AXRole") as? String) ?? "Unknown"

        // Get path
        let path = getElementPath(element)

        var elementAttributes = ElementAttributes(
            element: elementDesc,
            path: path,
            attributes: [:],
            depth: depth,
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            children: []
        )

        var hasRelevantValue = false

        for attr in attributes {
            // Check relevant attributes
            if attributesToCheck.contains(attr) {
                if let value = getAttributeValue(element, forAttribute: attr) {
                    let valueStr = describeValue(value)
                    if !valueStr.isEmpty &&
                       !unwantedValues.contains(valueStr) &&
                       valueStr.count > 1 &&
                       !unwantedLabels.contains(valueStr.lowercased()) {
                        // Before adding, check if adding this value would exceed the character limit
                        let newTotal = totalCharacterCount + valueStr.count
                        if newTotal > 1_000_000 {
                            shouldCancelTraversal = true
                            return nil
                        } else {
                            // Store attribute and its value
                            elementAttributes.attributes[attr] = valueStr
                            hasRelevantValue = true
                            totalCharacterCount = newTotal
                        }
                    }
                }
            }
        }

        // Traverse child elements
        var childrenElements: [ElementAttributes] = []
        for attr in attributes {
            if let childrenValue = getAttributeValue(element, forAttribute: attr) {
                if let elementArray = childrenValue as? [AXUIElement] {
                    for childElement in elementArray {
                        if let childAttributes = traverse(childElement, depth: depth + 1) {
                            childrenElements.append(childAttributes)
                        } else if shouldCancelTraversal {
                            break
                        }
                    }
                } else if let childElement = childrenValue as! AXUIElement? {
                    if let childAttributes = traverse(childElement, depth: depth + 1) {
                        childrenElements.append(childAttributes)
                    } else if shouldCancelTraversal {
                        break
                    }
                }
            }
            if shouldCancelTraversal {
                break
            }
        }
        elementAttributes.children = childrenElements

        if hasRelevantValue || !childrenElements.isEmpty {
            // Store the element with its attributes
            globalElementValues[appName]?[windowName]?.elements[elementWrapper] = elementAttributes
            return elementAttributes
        } else {
            return nil
        }
    }

    // Run traversal in dedicated queue
    traversalQueue.async {
        _ = traverse(element, depth: 0)

        // Reset state after traversal
        isTraversing = false
        shouldCancelTraversal = false

        let endTime = DispatchTime.now()
        let nanoTime = endTime.uptimeNanoseconds - startTime.uptimeNanoseconds
        let timeInterval = Double(nanoTime) / 1_000_000
        print("\(String(format: "%.2f", timeInterval))ms - ui traversal")

        measureGlobalElementValuesSize()
    }
}

func getRelevantValue(_ element: AXUIElement) -> String? {
    let attributesToCheck = ["AXDescription", "AXValue", "AXLabel", "AXRoleDescription", "AXHelp"]
    let unwantedValues = ["0", "", "3"]
    let unwantedLabels = [
        "window", "application", "group", "button", "image", "text",
        "pop up button", "region", "notifications", "table", "column",
        "html content"
    ]

    for attr in attributesToCheck {
        if let value = getAttributeValue(element, forAttribute: attr) {
            let valueStr = describeValue(value)
            if !valueStr.isEmpty &&
               !unwantedValues.contains(valueStr) &&
               valueStr.count > 1 &&
               !unwantedLabels.contains(valueStr.lowercased()) {
                return valueStr
            }
        }
    }

    return nil
}

// Modify axObserverCallback function
func axObserverCallback(observer: AXObserver, element: AXUIElement, notification: CFString, refcon: UnsafeMutableRawPointer?) {
    synchronizationQueue.async {
        // Exit if cleanup has started
        if isCleaningUp { return }

        // Don't process notifications if traversal is in progress
        if isTraversing { return }

        guard let context = currentContext else { return }

        let startTime = DispatchTime.now()
        let notificationStr = notification as String

        autoreleasepool {
            // Initialize the visitedElements set
            var visitedElements = Set<AXUIElementWrapper>()

            // Recursively check for changes in the element and its children
            let hasElementChanged = checkElementAndChildrenForChanges(
                element: element,
                context: context,
                visitedElements: &visitedElements
            )

            if hasElementChanged {
                hasChanges = true
                changedWindows.insert(WindowIdentifier(app: context.appName, window: context.windowName))

                let endTime = DispatchTime.now()
                let timeInterval = Double(endTime.uptimeNanoseconds - startTime.uptimeNanoseconds) / 1_000_000
                print("\(String(format: "%.2f", timeInterval))ms - element or its children updated")
            }
        }
    }
}

// New function to recursively check for changes
func checkElementAndChildrenForChanges(
    element: AXUIElement,
    context: MonitoringContext,
    visitedElements: inout Set<AXUIElementWrapper>
) -> Bool {
    var elementChanged = false

    let elementWrapper = AXUIElementWrapper(element: element)

    // Check if we've already visited this element
    if visitedElements.contains(elementWrapper) {
        return false
    }
    visitedElements.insert(elementWrapper)

    // Check if the element's relevant value has changed
    if let newValue = getRelevantValue(element) {
        let existingAttributes = globalElementValues[context.appName]?[context.windowName]?.elements[elementWrapper]?.attributes
        let oldValue = existingAttributes?.values.joined()

        if oldValue != newValue {
            // Update the element's attributes
            if globalElementValues[context.appName]?[context.windowName]?.elements[elementWrapper] == nil {
                // If the element is not in the global state, traverse and store it
                traverseAndStoreUIElements(element, appName: context.appName, windowName: context.windowName)
                return true
            } else {
                globalElementValues[context.appName]?[context.windowName]?.elements[elementWrapper]?.attributes["Value"] = newValue
                elementChanged = true
            }
        }
    }

    // Recursively check children
    if let children = getAttributeValue(element, forAttribute: kAXChildrenAttribute) as? [AXUIElement] {
        for child in children {
            if checkElementAndChildrenForChanges(element: child, context: context, visitedElements: &visitedElements) {
                elementChanged = true
            }
        }
    }

    return elementChanged
}

func setupAccessibilityNotifications(pid: pid_t, axApp: AXUIElement, appName: String, windowName: String) {
    // Store context globally with synchronization
    synchronizationQueue.sync {
        currentContext = MonitoringContext(appName: appName, windowName: windowName)
    }

    // Create observer with proper cleanup
    var observer: AXObserver?
    guard AXObserverCreate(pid, axObserverCallback, &observer) == .success,
          let axObserver = observer else {
        print("failed to create accessibility observer")
        return
    }

    // Clean up previous observer if exists
    if let oldObserver = currentObserver {
        CFRunLoopRemoveSource(
            CFRunLoopGetCurrent(),
            AXObserverGetRunLoopSource(oldObserver),
            .defaultMode
        )
    }

    currentObserver = axObserver

    CFRunLoopAddSource(
        CFRunLoopGetCurrent(),
        AXObserverGetRunLoopSource(axObserver),
        .defaultMode
    )

    // Register notifications for the app
    for (_, notification) in notificationsToObserve {
        let appResult = AXObserverAddNotification(axObserver, axApp, notification as CFString, nil)
        if appResult != .success {
            // Errors are expected for some elements, so we can silently ignore them
        }
    }

    // Register notifications for all windows and their elements
    if let windows = getAttributeValue(axApp, forAttribute: kAXWindowsAttribute) as? [AXUIElement] {
        for window in windows {
            registerNotificationsRecursively(element: window, observer: axObserver)
        }
    } else {
        // If we can't get windows, try to register with the main window
        if let mainWindow = getAttributeValue(axApp, forAttribute: kAXMainWindowAttribute) as! AXUIElement? {
            registerNotificationsRecursively(element: mainWindow, observer: axObserver)
        }
    }
}

// Recursive function to register notifications on elements
func registerNotificationsRecursively(element: AXUIElement, observer: AXObserver, depth: Int = 0) {
    // Limit recursion depth to prevent infinite loops
    if depth > 5 { return }

    for (_, notification) in notificationsToObserve {
        let result = AXObserverAddNotification(observer, element, notification as CFString, nil)
        if result != .success {
            // Errors are expected for some elements, so we can silently ignore them
        }
    }

    // Get children and recursively register notifications
    if let children = getAttributeValue(element, forAttribute: kAXChildrenAttribute) as? [AXUIElement] {
        for child in children {
            registerNotificationsRecursively(element: child, observer: observer, depth: depth + 1)
        }
    }
}

func getAttributeValue(_ element: AXUIElement, forAttribute attr: String) -> AnyObject? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attr as CFString, &value)
    return result == .success ? value : nil
}

func describeValue(_ value: AnyObject?) -> String {
    switch value {
    case let string as String:
        return string
    case let number as NSNumber:
        return number.stringValue
    case let point as NSPoint:
        return "(\(point.x), \(point.y))"
    case let size as NSSize:
        return "w=\(size.width) h=\(size.height)"
    case let rect as NSRect:
        return "x=\(rect.origin.x) y=\(rect.origin.y) w=\(rect.size.width) h=\(rect.size.height)"
    case let range as NSRange:
        return "loc=\(range.location) len=\(range.length)"
    case let url as URL:
        return url.absoluteString
    case let array as [AnyObject]:
        return array.isEmpty ? "empty array" : "array with \(array.count) elements"
    case let axValue as AXValue:
        return describeAXValue(axValue)
    case is AXUIElement:
        return "AXUIElement"
    case .none:
        return ""
    default:
        return String(describing: value)
    }
}

func describeAXValue(_ axValue: AXValue) -> String {
    let type = AXValueGetType(axValue)
    switch type {
    case .cgPoint:
        var point = CGPoint.zero
        AXValueGetValue(axValue, .cgPoint, &point)
        return "(\(point.x), \(point.y))"
    case .cgSize:
        var size = CGSize.zero
        AXValueGetValue(axValue, .cgSize, &size)
        return "w=\(size.width) h=\(size.height)"
    case .cgRect:
        var rect = CGRect.zero
        AXValueGetValue(axValue, .cgRect, &rect)
        return "x=\(rect.origin.x) y=\(rect.origin.y) w=\(rect.size.width) h=\(rect.size.height)"
    case .cfRange:
        var range = CFRange(location: 0, length: 0)
        AXValueGetValue(axValue, .cfRange, &range)
        return "loc=\(range.location) len=\(range.length)"
    default:
        return "unknown AXValue type"
    }
}

func getElementPath(_ element: AXUIElement) -> String {
    var path = [String]()
    var current: AXUIElement? = element

    while current != nil {
        if let role = getAttributeValue(current!, forAttribute: "AXRole") as? String {
            var elementDesc = role
            if let title = getAttributeValue(current!, forAttribute: "AXTitle") as? String, !title.isEmpty {
                elementDesc += "[\(title)]"
            }
            path.append(elementDesc)
        }

        // Get parent
        current = getAttributeValue(current!, forAttribute: "AXParent") as! AXUIElement?
    }

    // Reverse and join with arrows
    return path.reversed().joined(separator: " -> ")
}

func buildTextOutput(from windowState: WindowState) -> String {
    var textOutput = ""

    func processElement(_ elementAttributes: ElementAttributes, indentLevel: Int) {
        let indent = String(repeating: " ", count: indentLevel)

        // build output
        let text = elementAttributes.attributes.values
            .map { "[\($0)]" }
            .joined(separator: " ")

        if !text.isEmpty {
            textOutput += "\(indent)\(text)\n"
        }

        // Recursively process children
        for child in elementAttributes.children {
            processElement(child, indentLevel: indentLevel + 1)
        }
    }

    // Get and sort root elements (those with depth 0)
    let rootElements = windowState.elements.values.filter { $0.depth == 0 }
    let sortedRootElements = rootElements.sorted { (e1, e2) -> Bool in
        if abs(e1.y - e2.y) < 10 {
            return e1.x < e2.x
        }
        return e1.y < e2.y
    }

    for rootElement in sortedRootElements {
        processElement(rootElement, indentLevel: 0)
    }

    return textOutput
}

func saveToDatabase(windowId: WindowIdentifier, textOutput: String, timestamp: String) {
    let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

    let upsertSQL = """
        INSERT INTO ui_monitoring (
            timestamp, app, window, text_output
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(app, window) DO UPDATE SET
            timestamp = excluded.timestamp,
            text_output = excluded.text_output;
    """

    var stmt: OpaquePointer?

    if sqlite3_prepare_v2(db, upsertSQL, -1, &stmt, nil) == SQLITE_OK {
        // Bind values
        sqlite3_bind_text(stmt, 1, timestamp, -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 2, windowId.app, -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 3, windowId.window, -1, SQLITE_TRANSIENT)
        sqlite3_bind_text(stmt, 4, textOutput, -1, SQLITE_TRANSIENT)

        if sqlite3_step(stmt) != SQLITE_DONE {
            print("error updating row")
        }

        sqlite3_finalize(stmt)
    }
}

func saveElementValues() {
    if !hasChanges || changedWindows.isEmpty { return }

    let startTime = DispatchTime.now()
    let timestamp = ISO8601DateFormatter().string(from: Date())

    sqlite3_exec(db, "BEGIN TRANSACTION", nil, nil, nil)

    for windowId in changedWindows {
        guard let windowState = globalElementValues[windowId.app]?[windowId.window] else { continue }

        // Build text output
        let textOutput = buildTextOutput(from: windowState)

        // Store the formatted text output in the window state
        globalElementValues[windowId.app]?[windowId.window]?.textOutput = textOutput

        // Save to database
        saveToDatabase(windowId: windowId, textOutput: textOutput, timestamp: timestamp)
    }

    sqlite3_exec(db, "COMMIT", nil, nil, nil)

    // Clear the changed windows set
    changedWindows.removeAll()
    hasChanges = false

    let endTime = DispatchTime.now()
    let timeInterval = Double(endTime.uptimeNanoseconds - startTime.uptimeNanoseconds) / 1_000_000
    print("\(String(format: "%.2f", timeInterval))ms - saved to db")
}

// Add proper cleanup on exit
func cleanup() {
    // Indicate that cleanup has started
    synchronizationQueue.sync {
        isCleaningUp = true
    }

    // Remove observer from run loop
    if let observer = currentObserver {
        CFRunLoopRemoveSource(
            CFRunLoopGetCurrent(),
            AXObserverGetRunLoopSource(observer),
            .defaultMode
        )
        currentObserver = nil
    }

    // Close database
    if db != nil {
        sqlite3_close(db)
        db = nil
    }

    // Clear global state
    globalElementValues.removeAll()
    currentContext = nil
}

func measureGlobalElementValuesSize() {
    var totalElements = 0
    var totalAttributes = 0
    var totalStringLength = 0

    for (_, windows) in globalElementValues {
        for (_, windowState) in windows {
            totalElements += windowState.elements.count
            totalAttributes += windowState.elements.values.reduce(0) { $0 + $1.attributes.count }
            // Sum up the length of all attribute values
            totalStringLength += windowState.elements.values.reduce(0) { $0 + $1.attributes.values.reduce(0) { $0 + $1.count } }
        }
    }

    let mbSize = String(format: "%.3f", Double(totalStringLength) * 2 / 1024.0 / 1024.0)
    print("global state size: \(mbSize)mb")
}

public class UIMonitor {
    private static var shared: UIMonitor?
    private var isRunning = false

    public static func getInstance() -> UIMonitor {
        if shared == nil {
            shared = UIMonitor()
        }
        return shared!
    }

    // Start monitoring in background
    public func start() {
        if isRunning { return }
        isRunning = true

        DispatchQueue.global(qos: .background).async {
            startMonitoring()
        }
    }

    // Stop monitoring
    public func stop() {
        if !isRunning { return }
        cleanup()
        isRunning = false
    }

    // Get current text output for specific app/window
    public func getCurrentOutput(app: String, window: String? = nil) -> String? {
        let appName = app.lowercased()

        if let windowName = window?.lowercased() {
            if let windowState = globalElementValues[appName]?[windowName] {
                return buildTextOutput(from: windowState)
            }
            return nil
        }

        // If no window specified, return all windows' output concatenated
        var outputs: [String] = []
        if let windows = globalElementValues[appName] {
            for (windowName, windowState) in windows {
                let output = buildTextOutput(from: windowState)
                outputs.append("Window: \(windowName)\n\(output)")
            }
        }
        return outputs.isEmpty ? nil : outputs.joined(separator: "\n---\n")
    }

    // Get all current apps being monitored
    public func getMonitoredApps() -> [String] {
        return Array(globalElementValues.keys)
    }

    // Get all windows for a specific app
    public func getWindowsForApp(_ app: String) -> [String] {
        return globalElementValues[app.lowercased()]?.keys.map { $0 } ?? []
    }
}

// Wrapper for AXUIElement
struct AXUIElementWrapper: Hashable {
    let element: AXUIElement

    func hash(into hasher: inout Hasher) {
        hasher.combine(CFHash(element))
    }

    static func == (lhs: AXUIElementWrapper, rhs: AXUIElementWrapper) -> Bool {
        return CFEqual(lhs.element, rhs.element)
    }
}
