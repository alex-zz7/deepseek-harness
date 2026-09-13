using System.Diagnostics;
using System.Net.Sockets;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.WinForms;

namespace DeepSeekHarness;

static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }
}

sealed class MainForm : Form
{
    static readonly Regex UrlLine = new(
        @"https?://127\.0\.0\.1:\d+/\?token=[A-Za-z0-9._~-]+",
        RegexOptions.Compiled);

    readonly WebView2 web = new() { Dock = DockStyle.Fill, Visible = false };
    readonly Label status = new()
    {
        Dock = DockStyle.Fill,
        TextAlign = ContentAlignment.MiddleCenter,
        Text = "Starting DeepSeek Harness…",
        Font = new Font("Segoe UI", 12),
    };

    public MainForm()
    {
        Text = "DeepSeek Harness";
        Width = 1280;
        Height = 840;
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(web);
        Controls.Add(status);
        Load += async (_, _) => await Boot();
    }

    async Task Boot()
    {
        try
        {
            await web.EnsureCoreWebView2Async();
        }
        catch (Exception error)
        {
            Fail($"WebView2 is missing.\n{error.Message}");
            return;
        }

        web.CoreWebView2.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (Uri.TryCreate(e.Uri, UriKind.Absolute, out var uri)
                && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
            {
                web.CoreWebView2.Navigate(uri.ToString());
            }
        };

        var url = await EnsureServer();
        if (url is null) return;
        web.CoreWebView2.Navigate(url);
        status.Visible = false;
        web.Visible = true;
    }

    async Task<string?> EnsureServer()
    {
        var existing = ReadPublishedUrl();
        if (existing is not null && Probe(PortOf(existing))) return existing;

        var root = FindRepoRoot();
        if (root is null)
        {
            Fail("Could not find scripts\\harness.mjs. Keep DeepSeekHarness.exe next to the repo build folder.");
            return null;
        }

        var psi = new ProcessStartInfo
        {
            FileName = "node",
            Arguments = "scripts/harness.mjs start --no-open",
            WorkingDirectory = root,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        Process child;
        try
        {
            child = Process.Start(psi) ?? throw new InvalidOperationException("node did not start");
        }
        catch (Exception error)
        {
            Fail($"Need Node.js 20+ on PATH.\n{error.Message}");
            return null;
        }

        var found = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        void consider(string? line)
        {
            if (string.IsNullOrEmpty(line) || found.Task.IsCompleted) return;
            var match = UrlLine.Match(line);
            if (match.Success) found.TrySetResult(match.Value);
        }
        child.OutputDataReceived += (_, e) => consider(e.Data);
        child.ErrorDataReceived += (_, e) => consider(e.Data);
        child.BeginOutputReadLine();
        child.BeginErrorReadLine();

        using var delay = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        try
        {
            return await found.Task.WaitAsync(delay.Token);
        }
        catch (OperationCanceledException)
        {
            var published = ReadPublishedUrl();
            if (published is not null && Probe(PortOf(published))) return published;
            Fail("Timed out waiting for the local dsh server.");
            return null;
        }
    }

    void Fail(string message)
    {
        status.Text = message;
        MessageBox.Show(message, "DeepSeek Harness", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    static string? FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 6 && dir is not null; i++, dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "scripts", "harness.mjs")))
                return dir.FullName;
        }
        return null;
    }

    static string? ReadPublishedUrl()
    {
        var path = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            ".dsh",
            "web-url");
        if (!File.Exists(path)) return null;
        var url = File.ReadAllLines(path).FirstOrDefault()?.Trim() ?? "";
        return UrlLine.IsMatch(url) ? url : null;
    }

    static int PortOf(string url)
    {
        var match = Regex.Match(url, @"^https?://127\.0\.0\.1:(\d+)/");
        return match.Success ? int.Parse(match.Groups[1].Value) : 0;
    }

    static bool Probe(int port)
    {
        if (port <= 0) return false;
        try
        {
            using var client = new TcpClient();
            var task = client.ConnectAsync("127.0.0.1", port);
            return task.Wait(TimeSpan.FromMilliseconds(400)) && client.Connected;
        }
        catch
        {
            return false;
        }
    }
}
