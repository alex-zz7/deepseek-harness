// The project picker: choose a folder or one of your GitHub repositories and
// open it as a workspace.
//
// A workspace IS a project here — the sidebar already renders one row per
// registered directory — so this panel only has to produce a path and register
// it. Cloning writes to `~/Projects/<repo>`; the registration goes through the
// sidebar-editor plugin's `/projects` route, and the sidebar picks the new
// workspace up over its own follow stream with no reload.
//
// Deliberately a plain AppKit panel rather than a menu: the user asked for a
// search field, and a menu cannot hold one.

import AppKit

/// One line in the list.
private enum PickerRow {
    case header(String)
    case existing(title: String, path: String, detail: String)
    case remote(owner: String, name: String, isPrivate: Bool, detail: String)
    case command(id: String, title: String, detail: String)
}

final class ProjectPickerController: NSViewController, NSTableViewDataSource, NSTableViewDelegate,
    NSSearchFieldDelegate
{
    /// The running server, used to reach the plugin route.
    var serverBaseURL: URL?
    /// Called after a project has been registered, so the caller can react.
    var onRegistered: ((String) -> Void)?

    private let search = NSSearchField()
    private let table = NSTableView()
    private let status = NSTextField(labelWithString: "正在读取项目…")
    private var rows: [PickerRow] = []
    private var allRows: [PickerRow] = []
    private var busy = false

    /// Where clones land.
    private var projectsRoot: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Projects", isDirectory: true)
    }

    // MARK: - view

    override func loadView() {
        let root = NSView(frame: NSRect(x: 0, y: 0, width: 560, height: 480))

        search.placeholderString = "搜索项目或 GitHub 仓库…"
        search.delegate = self
        search.translatesAutoresizingMaskIntoConstraints = false

        let column = NSTableColumn(identifier: NSUserInterfaceItemIdentifier("main"))
        column.title = "项目"
        table.addTableColumn(column)
        table.headerView = nil
        table.rowHeight = 44
        table.dataSource = self
        table.delegate = self
        table.target = self
        table.doubleAction = #selector(activateSelection)

        let scroll = NSScrollView()
        scroll.documentView = table
        scroll.hasVerticalScroller = true
        scroll.translatesAutoresizingMaskIntoConstraints = false

        status.textColor = .secondaryLabelColor
        status.font = .systemFont(ofSize: 11)
        status.translatesAutoresizingMaskIntoConstraints = false

        root.addSubview(search)
        root.addSubview(scroll)
        root.addSubview(status)

        NSLayoutConstraint.activate([
            search.topAnchor.constraint(equalTo: root.topAnchor, constant: 14),
            search.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 14),
            search.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -14),

            scroll.topAnchor.constraint(equalTo: search.bottomAnchor, constant: 10),
            scroll.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 14),
            scroll.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -14),
            scroll.bottomAnchor.constraint(equalTo: status.topAnchor, constant: -8),

            status.leadingAnchor.constraint(equalTo: root.leadingAnchor, constant: 14),
            status.trailingAnchor.constraint(equalTo: root.trailingAnchor, constant: -14),
            status.bottomAnchor.constraint(equalTo: root.bottomAnchor, constant: -12),
        ])

        view = root
    }

    override func viewDidAppear() {
        super.viewDidAppear()
        view.window?.makeFirstResponder(search)
        reload()
    }

    // MARK: - data

    private func reload() {
        var next: [PickerRow] = []
        next.append(.header("开始"))
        next.append(.command(id: "folder", title: "打开文件夹…", detail: "把这个 Mac 上的目录作为项目"))
        next.append(.command(id: "new", title: "新建文件夹…", detail: "在 ~/Projects 下新建一个项目"))

        allRows = next
        rows = next
        table.reloadData()
        status.stringValue = "正在读取项目…"

        fetchProjects { [weak self] existing in
            guard let self else { return }
            var withLocal = next
            if !existing.isEmpty {
                withLocal.append(.header("最近"))
                for project in existing {
                    withLocal.append(
                        .existing(
                            title: project.title,
                            path: project.path,
                            detail: "\(project.sessionCount) 个会话"))
                }
            }
            self.allRows = withLocal
            self.applyFilter()
            self.status.stringValue = "正在读取 GitHub 仓库…"

            self.loadRemote { [weak self] result in
                guard let self else { return }
                switch result {
                case .success(let remotes):
                    var withRemote = withLocal
                    if !remotes.isEmpty {
                        withRemote.append(.header("GitHub"))
                        for repo in remotes {
                            withRemote.append(
                                .remote(
                                    owner: repo.owner, name: repo.name, isPrivate: repo.isPrivate,
                                    detail: repo.isPrivate ? "私有" : "公开"))
                        }
                    }
                    self.allRows = withRemote
                    self.applyFilter()
                    self.status.stringValue =
                        remotes.isEmpty
                        ? "GitHub 账号下没有仓库"
                        : "\(remotes.count) 个 GitHub 仓库 · 克隆到 ~/Projects"
                case .failure(let error):
                    self.status.stringValue = error.message
                }
            }
        }
    }

    private func applyFilter() {
        let needle = search.stringValue.trimmingCharacters(in: .whitespaces).lowercased()
        guard !needle.isEmpty else {
            rows = allRows
            table.reloadData()
            return
        }
        // Keep a section header only when something under it survives.
        var filtered: [PickerRow] = []
        var pendingHeader: PickerRow?
        for row in allRows {
            switch row {
            case .header:
                pendingHeader = row
            case .existing(let title, let path, let detail):
                if title.lowercased().contains(needle) || path.lowercased().contains(needle) {
                    if let header = pendingHeader { filtered.append(header); pendingHeader = nil }
                    filtered.append(.existing(title: title, path: path, detail: detail))
                }
            case .remote(let owner, let name, let isPrivate, let detail):
                let full = "\(owner)/\(name)".lowercased()
                if full.contains(needle) || detail.lowercased().contains(needle) {
                    if let header = pendingHeader { filtered.append(header); pendingHeader = nil }
                    filtered.append(.remote(owner: owner, name: name, isPrivate: isPrivate, detail: detail))
                }
            case .command(let id, let title, let detail):
                if title.lowercased().contains(needle) {
                    if let pending = pendingHeader { filtered.append(pending); pendingHeader = nil }
                    filtered.append(.command(id: id, title: title, detail: detail))
                }
            }
        }
        rows = filtered
        table.reloadData()
    }

    func controlTextDidChange(_ obj: Notification) {
        applyFilter()
    }

    // MARK: - table

    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }

    func tableView(_ tableView: NSTableView, isGroupRow row: Int) -> Bool {
        if case .header = rows[row] { return true }
        return false
    }

    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool {
        if case .header = rows[row] { return false }
        return true
    }

    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let identifier = NSUserInterfaceItemIdentifier("cell")
        let cell =
            tableView.makeView(withIdentifier: identifier, owner: self) as? NSTableCellView
            ?? makeCell(identifier: identifier)

        switch rows[row] {
        case .header(let title):
            cell.textField?.stringValue = title
            cell.textField?.font = .systemFont(ofSize: 11, weight: .semibold)
            cell.textField?.textColor = .secondaryLabelColor
            cell.imageView?.image = nil
        case .existing(let title, let path, let detail):
            cell.textField?.stringValue = "\(title)\n\(detail) · \(path)"
            cell.textField?.font = .systemFont(ofSize: 13)
            cell.textField?.textColor = .labelColor
            cell.imageView?.image = NSImage(systemSymbolName: "folder", accessibilityDescription: nil)
        case .remote(let owner, let name, let isPrivate, let detail):
            cell.textField?.stringValue = "\(name)\n\(owner) · \(detail)"
            cell.textField?.font = .systemFont(ofSize: 13)
            cell.textField?.textColor = .labelColor
            cell.imageView?.image = NSImage(
                systemSymbolName: isPrivate ? "lock" : "cloud", accessibilityDescription: nil)
        case .command(_, let title, let detail):
            cell.textField?.stringValue = "\(title)\n\(detail)"
            cell.textField?.font = .systemFont(ofSize: 13)
            cell.textField?.textColor = .labelColor
            cell.imageView?.image = NSImage(systemSymbolName: "plus", accessibilityDescription: nil)
        }
        return cell
    }

    private func makeCell(identifier: NSUserInterfaceItemIdentifier) -> NSTableCellView {
        let cell = NSTableCellView()
        cell.identifier = identifier

        let image = NSImageView()
        image.translatesAutoresizingMaskIntoConstraints = false
        image.symbolConfiguration = .init(pointSize: 14, weight: .regular)

        let label = NSTextField(labelWithString: "")
        label.translatesAutoresizingMaskIntoConstraints = false
        label.lineBreakMode = .byTruncatingMiddle
        label.maximumNumberOfLines = 2
        label.font = .systemFont(ofSize: 13)

        cell.addSubview(image)
        cell.addSubview(label)
        cell.imageView = image
        cell.textField = label

        NSLayoutConstraint.activate([
            image.leadingAnchor.constraint(equalTo: cell.leadingAnchor, constant: 4),
            image.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
            image.widthAnchor.constraint(equalToConstant: 20),
            label.leadingAnchor.constraint(equalTo: image.trailingAnchor, constant: 8),
            label.trailingAnchor.constraint(equalTo: cell.trailingAnchor, constant: -4),
            label.centerYAnchor.constraint(equalTo: cell.centerYAnchor),
        ])
        return cell
    }

    @objc private func activateSelection() {
        let index = table.clickedRow >= 0 ? table.clickedRow : table.selectedRow
        guard index >= 0, index < rows.count else { return }
        switch rows[index] {
        case .header:
            return
        case .existing(_, let path, _):
            register(path: path)
        case .remote(let owner, let name, _, _):
            clone(owner: owner, name: name)
        case .command(let id, _, _):
            if id == "folder" { chooseFolder() } else { createFolder() }
        }
    }

    // MARK: - actions

    private func chooseFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.prompt = "选择"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        register(path: url.path)
    }

    private func createFolder() {
        let alert = NSAlert()
        alert.messageText = "新建项目文件夹"
        alert.informativeText = "会在 \(projectsRoot.path) 下创建"
        let field = NSTextField(frame: NSRect(x: 0, y: 0, width: 260, height: 24))
        field.placeholderString = "文件夹名"
        alert.accessoryView = field
        alert.addButton(withTitle: "创建")
        alert.addButton(withTitle: "取消")
        guard alert.runModal() == .alertFirstButtonReturn else { return }
        let name = field.stringValue.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        let target = projectsRoot.appendingPathComponent(name, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
            register(path: target.path)
        } catch {
            report("无法创建文件夹：\(error.localizedDescription)")
        }
    }

    private func clone(owner: String, name: String) {
        guard !busy else { return }
        busy = true
        let target = projectsRoot.appendingPathComponent(name, isDirectory: true)
        status.stringValue = "正在克隆 \(owner)/\(name)…"

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            try? FileManager.default.createDirectory(at: self.projectsRoot, withIntermediateDirectories: true)

            if FileManager.default.fileExists(atPath: target.path) {
                DispatchQueue.main.async {
                    self.busy = false
                    self.status.stringValue = "已存在，直接打开：\(target.path)"
                    self.register(path: target.path)
                }
                return
            }

            guard let result = Self.runGh(["repo", "clone", "\(owner)/\(name)", target.path]) else {
                DispatchQueue.main.async {
                    self.busy = false
                    self.report("没有找到 GitHub CLI。装一个：brew install gh")
                }
                return
            }

            DispatchQueue.main.async {
                self.busy = false
                if result.status == 0 {
                    self.status.stringValue = "已克隆到 \(target.path)"
                    self.register(path: target.path)
                } else {
                    let detail = [result.error, result.output]
                        .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                        .first { !$0.isEmpty } ?? "gh 返回了错误"
                    self.report("克隆失败：\(detail)")
                }
            }
        }
    }

    /// Register a directory as a workspace through the plugin route.
    private func register(path: String) {
        guard let base = serverBaseURL, let url = URL(string: "/sidebar-editor/projects", relativeTo: base) else {
            report("没有可用的服务地址")
            return
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["path": path])

        URLSession.shared.dataTask(with: request) { [weak self] data, _, error in
            DispatchQueue.main.async {
                guard let self else { return }
                if let error {
                    self.report("注册失败：\(error.localizedDescription)")
                    return
                }
                let body = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any]
                if let title = (body?["project"] as? [String: Any])?["title"] as? String {
                    self.status.stringValue = "已打开 \(title)"
                    self.onRegistered?(path)
                    if let sheet = self.view.window, let parent = sheet.sheetParent {
                        parent.endSheet(sheet)
                    } else {
                        self.view.window?.close()
                    }
                } else {
                    let message = body?["message"] as? String ?? "未知错误"
                    self.report("注册失败：\(message)")
                }
            }
        }.resume()
    }

    private func report(_ message: String) {
        status.stringValue = message
    }

    // MARK: - sources

    private struct LocalProject {
        let title: String
        let path: String
        let sessionCount: Int
    }

    private struct RemoteRepo {
        let owner: String
        let name: String
        let isPrivate: Bool
    }

    /// A user-facing reason the GitHub list could not be read.
    private struct PickerFailure: Error {
        let message: String
    }

    // MARK: - GitHub CLI

    /// The absolute path to `gh`.
    ///
    /// A Finder-launched app inherits a minimal `PATH` (`/usr/bin:/bin:…`), so
    /// `/usr/bin/env gh` finds nothing even though the user's shell has it —
    /// which is exactly what happened here, because Homebrew installs `gh` to
    /// `/opt/homebrew/bin`. Probe the usual locations, then ask the login shell
    /// once as a last resort.
    private static let ghPath: String? = {
        let home = FileManager.default.homeDirectoryForCurrentUser
        let candidates = [
            "/opt/homebrew/bin/gh",
            "/usr/local/bin/gh",
            "/opt/local/bin/gh",
            home.appendingPathComponent(".local/bin/gh").path,
            "/usr/bin/gh",
        ]
        for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
            return path
        }
        let shell = ProcessInfo.processInfo.environment["SHELL"] ?? "/bin/zsh"
        let process = Process()
        process.executableURL = URL(fileURLWithPath: shell)
        process.arguments = ["-lc", "command -v gh"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()
        guard (try? process.run()) != nil else { return nil }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        let found = String(data: data, encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return found.isEmpty ? nil : found
    }()

    /// Run `gh` and hand back its exit status and streams.
    ///
    /// `gh` shells out to `git` (and to credential helpers), so the child gets a
    /// PATH that includes the Homebrew prefixes even though the app's own is bare.
    private static func runGh(_ arguments: [String]) -> (status: Int32, output: String, error: String)? {
        guard let ghPath else { return nil }
        let process = Process()
        process.executableURL = URL(fileURLWithPath: ghPath)
        process.arguments = arguments
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        process.environment = environment

        let out = Pipe()
        let err = Pipe()
        process.standardOutput = out
        process.standardError = err
        guard (try? process.run()) != nil else { return nil }
        // Drain before waiting: a full pipe would deadlock the child.
        let outData = out.fileHandleForReading.readDataToEndOfFile()
        let errData = err.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        return (
            process.terminationStatus,
            String(data: outData, encoding: .utf8) ?? "",
            String(data: errData, encoding: .utf8) ?? ""
        )
    }

    /// Read the registered workspaces off the plugin route.
    private func fetchProjects(completion: @escaping ([LocalProject]) -> Void) {
        guard let base = serverBaseURL, let url = URL(string: "/sidebar-editor/projects", relativeTo: base) else {
            completion([])
            return
        }
        var request = URLRequest(url: url)
        // Bounded: a missing server must not hang the panel.
        request.timeoutInterval = 4
        URLSession.shared.dataTask(with: request) { data, _, _ in
            var projects: [LocalProject] = []
            if let data,
                let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                let list = body["projects"] as? [[String: Any]]
            {
                projects = list.compactMap { entry in
                    guard let title = entry["title"] as? String, let path = entry["path"] as? String
                    else { return nil }
                    return LocalProject(title: title, path: path, sessionCount: entry["sessionCount"] as? Int ?? 0)
                }
            }
            DispatchQueue.main.async { completion(projects) }
        }.resume()
    }

    private func loadRemote(completion: @escaping (Result<[RemoteRepo], PickerFailure>) -> Void) {
        DispatchQueue.global(qos: .userInitiated).async {
            guard
                let result = Self.runGh([
                    "repo", "list", "--limit", "200",
                    "--json", "nameWithOwner,name,isPrivate",
                ])
            else {
                DispatchQueue.main.async {
                    completion(.failure(PickerFailure(message: "没有找到 GitHub CLI。装一个：brew install gh，然后 gh auth login")))
                }
                return
            }
            guard result.status == 0 else {
                let detail = result.error.trimmingCharacters(in: .whitespacesAndNewlines)
                DispatchQueue.main.async {
                    completion(.failure(PickerFailure(message: "读取 GitHub 失败：\(detail.isEmpty ? "gh 返回了错误" : detail)")))
                }
                return
            }

            let list = (try? JSONSerialization.jsonObject(with: Data(result.output.utf8))) as? [[String: Any]] ?? []
            let repos: [RemoteRepo] = list.compactMap { entry in
                guard let full = entry["nameWithOwner"] as? String else { return nil }
                let parts = full.split(separator: "/", maxSplits: 1)
                guard parts.count == 2 else { return nil }
                return RemoteRepo(
                    owner: String(parts[0]),
                    name: String(parts[1]),
                    isPrivate: entry["isPrivate"] as? Bool ?? false)
            }
            DispatchQueue.main.async { completion(.success(repos)) }
        }
    }
}

/// Cursor's picker: "Start from scratch" makes an empty git repo immediately;
/// "New folder" asks for a name and location with a save dialog, then `git init`.
enum WorkspaceFolderFactory {
    static var projectsRoot: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Projects", isDirectory: true)
    }

    static func createScratch() throws -> URL {
        try FileManager.default.createDirectory(at: projectsRoot, withIntermediateDirectories: true)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd"
        let base = "project-\(formatter.string(from: Date()))"
        var url = projectsRoot.appendingPathComponent(base, isDirectory: true)
        var n = 2
        while FileManager.default.fileExists(atPath: url.path) {
            url = projectsRoot.appendingPathComponent("\(base)-\(n)", isDirectory: true)
            n += 1
        }
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        initializeGit(at: url)
        return url
    }

    static func presentNewFolder(from window: NSWindow?, completion: @escaping (URL?) -> Void) {
        try? FileManager.default.createDirectory(at: projectsRoot, withIntermediateDirectories: true)
        let panel = NSSavePanel()
        panel.canCreateDirectories = true
        panel.title = "新建文件夹"
        panel.message = "选择新文件夹的位置和名称"
        panel.nameFieldLabel = "名称："
        panel.nameFieldStringValue = "Untitled"
        panel.prompt = "创建"
        panel.directoryURL = projectsRoot
        let finish: (NSApplication.ModalResponse) -> Void = { response in
            guard response == .OK, let url = panel.url else {
                completion(nil)
                return
            }
            do {
                try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
                initializeGit(at: url)
                completion(url)
            } catch {
                completion(nil)
            }
        }
        if let window {
            panel.beginSheetModal(for: window, completionHandler: finish)
        } else {
            finish(panel.runModal())
        }
    }

    private static func initializeGit(at url: URL) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        process.arguments = ["-C", url.path, "init"]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
        process.waitUntilExit()
    }
}
