// ShellDemo.swift — 最小「统一管理窗口」验证程序
//
// 目的：证明「切换显示」这一层到底有多简单，并当场暴露真正的难点。
// 编译：swiftc -O -o /tmp/shelldemo ShellDemo.swift
// 运行：/tmp/shelldemo            普通模式（只有主窗口）
//       /tmp/shelldemo --shot     顺带打开三个独立 profile 窗口，方便截图对比登录态

import AppKit
import Observation
import WebKit

// MARK: - 数据模型：一个 app 就是一个 URL + 一个 profile

enum ShellApp: String, CaseIterable, Identifiable {
    case harness
    case githubWork
    case githubPersonal

    var id: String { rawValue }

    var title: String {
        switch self {
        case .harness: "DeepSeek Harness"
        case .githubWork: "GitHub · 工作账号"
        case .githubPersonal: "GitHub · 个人账号"
        }
    }

    var url: URL {
        switch self {
        case .harness: URL(string: "http://127.0.0.1:51531")!
        case .githubWork: URL(string: "https://github.com/alex-zz7")!
        case .githubPersonal: URL(string: "https://github.com/torvalds")!
        }
    }

    /// 每个 app 一个独立的持久化 WebKit 数据存储 —— 这就是「登录态互不串」的全部实现。
    /// 关键 API：WKWebsiteDataStore(forIdentifier:)  ← macOS 14+ 才有
    /// macOS 14 之前，持久化 data store 全局只有一个，多账号同时在线根本做不到。
    var profileID: UUID {
        switch self {
        case .harness: UUID(uuidString: "11111111-1111-1111-1111-111111111111")!
        case .githubWork: UUID(uuidString: "22222222-2222-2222-2222-222222222222")!
        case .githubPersonal: UUID(uuidString: "33333333-3333-3333-3333-333333333333")!
        }
    }
}

// MARK: - 一个 app = 一个常驻 WKWebView（切换 = 改 hidden，不销毁）

final class WebHost: NSObject {
    let app: ShellApp
    let webView: WKWebView
    var profileLabel: String { app.profileID.uuidString.prefix(8).lowercased() + "…" }

    init(_ app: ShellApp) {
        self.app = app
        let config = WKWebViewConfiguration()
        config.websiteDataStore = WKWebsiteDataStore(forIdentifier: app.profileID)
        // 后台标签的 JS 定时器会被 WebKit 降到 ~1Hz，Harness 这类长连接会断。
        // 这两行是必须的「保活」开关。
        config.preferences.isElementFullscreenEnabled = true
        webView = WKWebView(frame: .zero, configuration: config)
        super.init()
        webView.allowsBackForwardNavigationGestures = true

        // 伪装成 Safari，减少一部分站点的 UA 嗅探（但挡不住 Google 的主动拦截）
        webView.customUserAgent = nil
    }

    func load() {
        webView.load(URLRequest(url: app.url))
    }

    func setVisible(_ visible: Bool) {
        webView.isHidden = !visible
    }
}

// MARK: - 壳的状态

@MainActor
@Observable
final class ShellState {
    var apps: [ShellApp] = [.harness, .githubWork, .githubPersonal]
    var selected: ShellApp = .harness
    var hosts: [ShellApp: WebHost] = [:]

    func host(for app: ShellApp) -> WebHost {
        if let existing = hosts[app] { return existing }
        let made = WebHost(app)
        hosts[app] = made
        made.load()
        return made
    }

    func select(_ app: ShellApp) {
        selected = app
        for (key, host) in hosts {
            host.setVisible(key == app)
        }
    }
}

// MARK: - 侧边栏：最朴素的一列按钮

@MainActor
final class SidebarView: NSView {
    private let state: ShellState
    private var rows: [NSButton] = []

    init(state: ShellState) {
        self.state = state
        super.init(frame: .zero)
        wantsLayer = true
        layer?.backgroundColor = NSColor.windowBackgroundColor.withAlphaComponent(0.6).cgColor

        let stack = NSStackView()
        stack.orientation = .vertical
        stack.alignment = .leading
        stack.spacing = 2
        stack.edgeInsets = NSEdgeInsets(top: 14, left: 10, bottom: 14, right: 10)
        stack.translatesAutoresizingMaskIntoConstraints = false
        addSubview(stack)

        let header = NSTextField(labelWithString: "BIRDS")
        header.font = .systemFont(ofSize: 11, weight: .semibold)
        header.textColor = .secondaryLabelColor
        stack.addArrangedSubview(header)
        stack.setCustomSpacing(10, after: header)

        for app in state.apps {
            let button = NSButton(title: app.title, target: self, action: #selector(tapped(_:)))
            button.bezelStyle = .recessed
            button.isBordered = false
            button.alignment = .left
            button.font = .systemFont(ofSize: 13)
            button.tag = state.apps.firstIndex(of: app) ?? 0
            button.translatesAutoresizingMaskIntoConstraints = false
            button.widthAnchor.constraint(equalToConstant: 176).isActive = true
            button.heightAnchor.constraint(equalToConstant: 30).isActive = true
            stack.addArrangedSubview(button)
            rows.append(button)
        }

        NSLayoutConstraint.activate([
            stack.topAnchor.constraint(equalTo: topAnchor),
            stack.leadingAnchor.constraint(equalTo: leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: trailingAnchor),
        ])

        // Cmd+1/2/3 直接切换 —— 真正的「用起来快」靠这个，不靠 UI
        for (index, app) in state.apps.enumerated() {
            let item = NSMenuItem(title: app.title, action: #selector(selectByMenu(_:)), keyEquivalent: "\(index + 1)")
            item.keyEquivalentModifierMask = [.command]
            item.tag = index
            item.target = self
            NSApp.mainMenu?.addItem(item)
        }
        refresh()
    }

    required init?(coder: NSCoder) { fatalError() }

    @objc private func tapped(_ sender: NSButton) {
        state.select(state.apps[sender.tag])
        refresh()
    }

    @objc private func selectByMenu(_ sender: NSMenuItem) {
        state.select(state.apps[sender.tag])
        refresh()
    }

    private func refresh() {
        for (index, row) in rows.enumerated() {
            let isSelected = state.apps[index] == state.selected
            row.contentTintColor = isSelected ? .controlAccentColor : .labelColor
            row.font = .systemFont(ofSize: 13, weight: isSelected ? .semibold : .regular)
        }
    }
}

// MARK: - 主窗口：侧边栏 + 一块内容区

@MainActor
final class MainWindowController: NSWindowController {
    private let state = ShellState()
    private let contentHost = NSView()
    private var sidebar: SidebarView!

    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1100, height: 720),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Birds"
        window.titlebarAppearsTransparent = true
        self.init(window: window)

        let root = NSView()
        window.contentView = root

        sidebar = SidebarView(state: state)
        contentHost.translatesAutoresizingMaskIntoConstraints = false
        sidebar.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(sidebar)
        root.addSubview(contentHost)

        NSLayoutConstraint.activate([
            sidebar.topAnchor.constraint(equalTo: root.topAnchor),
            sidebar.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            sidebar.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            sidebar.widthAnchor.constraint(equalToConstant: 196),
            contentHost.topAnchor.constraint(equalTo: root.topAnchor),
            contentHost.bottomAnchor.constraint(equalTo: root.bottomAnchor),
            contentHost.leadingAnchor.constraint(equalTo: sidebar.trailingAnchor),
            contentHost.trailingAnchor.constraint(equalTo: root.trailingAnchor),
        ])

        show(state.selected)
        window.center()
    }

    /// 这就是「切换显示」的全部：把目标 webView 贴满内容区，其余 hidden。
    private func show(_ app: ShellApp) {
        let host = state.host(for: app)
        for subview in contentHost.subviews { subview.removeFromSuperview() }
        let view = host.webView
        view.translatesAutoresizingMaskIntoConstraints = false
        contentHost.addSubview(view)
        NSLayoutConstraint.activate([
            view.topAnchor.constraint(equalTo: contentHost.topAnchor),
            view.bottomAnchor.constraint(equalTo: contentHost.bottomAnchor),
            view.leadingAnchor.constraint(equalTo: contentHost.leadingAnchor),
            view.trailingAnchor.constraint(equalTo: contentHost.trailingAnchor),
        ])
        state.select(app)
    }
}

// MARK: - 启动

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var main: MainWindowController?
    private var probeWindows: [NSWindow] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let appMenuItem = NSMenuItem()
        menu.addItem(appMenuItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit Birds", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenuItem.submenu = appMenu
        NSApp.mainMenu = menu

        main = MainWindowController()
        main?.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)

        if CommandLine.arguments.contains("--shot") {
            // 同一时刻打开三个独立 profile 的窗口，用来肉眼确认「登录态 / 存储完全隔离」
            for (offset, app) in ShellApp.allCases.enumerated() {
                let window = NSWindow(
                    contentRect: NSRect(x: 120 + offset * 60, y: 120 - offset * 60, width: 520, height: 380),
                    styleMask: [.titled, .closable],
                    backing: .buffered,
                    defer: false
                )
                window.title = "profile \(app.profileID.uuidString.prefix(8)) — \(app.title)"
                let host = WebHost(app)
                window.contentView = host.webView
                window.makeKeyAndOrderFront(nil)
                host.load()
                probeWindows.append(window)
            }
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}
