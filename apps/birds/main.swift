// main.swift — 可执行入口（与 ShellDemo.swift 一起编译）
import AppKit

MainActor.assumeIsolated {
    let delegate = AppDelegate()
    let application = NSApplication.shared
    application.setActivationPolicy(.regular)
    application.delegate = delegate
    application.run()
}
