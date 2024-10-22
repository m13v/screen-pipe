import Cocoa
import ApplicationServices
import Foundation
import Dispatch

class QueueElement {
    let element: AXUIElement
    let depth: Int
    
    init(_ element: AXUIElement, depth: Int) {
        self.element = element
        self.depth = depth
    }
}

// Global set to store unique values across multiple runs
var globalUniqueValues = Set<String>()

func printAllAttributeValues(_ startElement: AXUIElement) -> [String] {
    var elements: [(CGPoint, CGSize, String)] = []
    var visitedElements = Set<AXUIElement>()
    let unwantedValues = ["0", "", "", "3", ""]
    let unwantedLabels = [
        "window", "application", "group", "button", "image", "text",
        "pop up button", "region", "notifications", "table", "column",
        "html content"
    ]
    
    func traverseHierarchy(_ element: AXUIElement, depth: Int) {
        guard !visitedElements.contains(element) else { return }
        visitedElements.insert(element)
        
        var attributeNames: CFArray?
        let result = AXUIElementCopyAttributeNames(element, &attributeNames)
        
        guard result == .success, let attributes = attributeNames as? [String] else { return }
        
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
        
        for attr in attributes {
            if ["AXDescription", "AXValue", "AXLabel", "AXRoleDescription", "AXHelp"].contains(attr) {
                if let value = getAttributeValue(element, forAttribute: attr) {
                    let valueStr = describeValue(value)
                    if !valueStr.isEmpty && !unwantedValues.contains(valueStr) && valueStr.count > 1 &&
                       !unwantedLabels.contains(valueStr.lowercased()) {
                        // Check against global unique values
                        if !globalUniqueValues.contains(valueStr) {
                            elements.append((position, size, valueStr))
                            globalUniqueValues.insert(valueStr)
                        }
                    }
                }
            }
            
            // Traverse child elements
            if let childrenValue = getAttributeValue(element, forAttribute: attr) {
                if let elementArray = childrenValue as? [AXUIElement] {
                    for childElement in elementArray {
                        traverseHierarchy(childElement, depth: depth + 1)
                    }
                } else if let childElement = childrenValue as! AXUIElement? {
                    traverseHierarchy(childElement, depth: depth + 1)
                }
            }
        }
    }
    
    traverseHierarchy(startElement, depth: 0)
    
    // Sort elements from top to bottom, then left to right
    elements.sort { (a, b) in
        if a.0.y != b.0.y {
            return a.0.y < b.0.y
        } else {
            return a.0.x < b.0.x
        }
    }

    // Return only new unique values
    return elements.map { $0.2 }
}

func formatCoordinates(_ position: CGPoint, _ size: CGSize) -> String {
    return String(format: "(x:%.0f,y:%.0f,w:%.0f,h:%.0f)", position.x, position.y, size.width, size.height)
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
        return array.isEmpty ? "Empty array" : "Array with \(array.count) elements"
    case let axValue as AXValue:
        return describeAXValue(axValue)
    case is AXUIElement:
        return "AXUIElement"
    case .none:
        return "None"
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
        return "Unknown AXValue type"
    }
}

func getAttributeValue(_ element: AXUIElement, forAttribute attr: String) -> AnyObject? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attr as CFString, &value)
    return result == .success ? value : nil
}

func printAllAttributeValuesForCurrentApp() -> [String] {
    // Allow the run loop to process events
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 0.01))
    
    guard let app = NSWorkspace.shared.frontmostApplication else {
        print("no frontmost application found")
        return []
    }
    
    let pid = app.processIdentifier
    let axApp = AXUIElementCreateApplication(pid)
    
    // Get the focused window
    var windowValue: AnyObject?
    let result = AXUIElementCopyAttributeValue(axApp, kAXFocusedWindowAttribute as CFString, &windowValue)
    
    var windowName = "unknown window"
    if result == .success, let window = windowValue as! AXUIElement? {
        if let titleValue = getAttributeValue(window, forAttribute: kAXTitleAttribute) as? String {
            windowName = titleValue
        }
    }
    
    let startTime = CFAbsoluteTimeGetCurrent()
    let newUniqueValues = printAllAttributeValues(axApp)
    let totalTime = CFAbsoluteTimeGetCurrent() - startTime
    let outputLength = newUniqueValues.joined().count
    
    print("time: \(Int(round(totalTime * 1000)))ms, new chars: \(outputLength), globalUniqueValues.count: \(globalUniqueValues.count), app: \(app.localizedName?.lowercased() ?? "unknown"), window: \(windowName.lowercased())")
    
    return newUniqueValues
}

// usage
// print("waiting 1 second before starting...") //REMOVE BEFORE DPELOYING
// Thread.sleep(forTimeInterval: 1.0) //REMOVE BEFORE DPELOYING
// let uniqueValues = printAllAttributeValuesForCurrentApp()
// let output = uniqueValues.joined(separator: "\n")
// let currentPath = FileManager.default.currentDirectoryPath
// let filePath = (currentPath as NSString).appendingPathComponent("ui_attributes.txt")
// try? output.write(toFile: filePath, atomically: true, encoding: String.Encoding.utf8)
// print("file saved to: \(filePath)")
Thread.sleep(forTimeInterval: 1.0)
func mainLoop() {
    while true {
        // print("waiting 1 second before starting...") //REMOVE BEFORE DPELOYING
        // Thread.sleep(forTimeInterval: 1.0)
        // print("Scanning UI attributes...")
        let newUniqueValues = printAllAttributeValuesForCurrentApp()        
    }
}

// Start the main loop
mainLoop()
