#!/usr/bin/env python3
"""把 gh repo list 的 JSON 渲染成人类与 Agent 都能路由的 Markdown 索引。

用法: gen-github-index.py <repos.json> <owner> <输出目录>
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

VIS_LABEL = {
    "PUBLIC": "公开",
    "PRIVATE": "私有",
    "INTERNAL": "内部",
}


def lang(repo):
    return (repo.get("primaryLanguage") or {}).get("name") or "—"


def topics(repo):
    """gh 返回的 repositoryTopics 是 [{"name": ...}] 形式。"""
    raw = repo.get("repositoryTopics") or []
    names = []
    for t in raw:
        if isinstance(t, dict):
            names.append(str(t.get("name") or t.get("topic") or ""))
        else:
            names.append(str(t))
    return ", ".join(n for n in names if n) or "—"


def clean(text):
    """避免表格被换行符撑破。"""
    if not text:
        return "—"
    return " ".join(str(text).split()).replace("|", "\\|")


def main():
    src, owner, outdir = sys.argv[1], sys.argv[2], Path(sys.argv[3])
    repos = json.loads(Path(src).read_text())
    outdir.mkdir(parents=True, exist_ok=True)

    own = [r for r in repos if not r.get("isFork")]
    forks = [r for r in repos if r.get("isFork")]
    own.sort(key=lambda r: r.get("pushedAt") or "", reverse=True)
    forks.sort(key=lambda r: r.get("pushedAt") or "", reverse=True)

    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    lines = [
        f"# GitHub 项目索引 — {owner}",
        "",
        f"> 自动生成于 {stamp}，共 **{len(repos)}** 个仓库："
        f"原创 {len(own)} / Fork {len(forks)}。",
        ">",
        "> 重新生成：`./knowledge/scripts/sync-github.sh`",
        "",
        "## Agent 使用说明",
        "",
        "1. **先读本文件**再决定去看哪个仓库，不要盲目遍历。",
        "2. 想了解某个项目的实现细节，再看 `projects/<仓库名>.md`。",
        "3. 本索引只是元数据（描述、语言、时间、话题），**不含源码**。",
        "4. 需要读源码时，先确认本地是否已有克隆，再用 `gh repo clone <name>`。",
        "",
        "## 原创项目",
        "",
        "| 仓库 | 可见性 | 语言 | 最近推送 | 描述 |",
        "|---|---|---|---|---|",
    ]
    for r in own:
        lines.append(
            f"| [`{r['name']}`]({r['url']}) | {VIS_LABEL.get(r['visibility'], r['visibility'])} "
            f"| {lang(r)} | {(r.get('pushedAt') or '—')[:10]} | {clean(r.get('description'))} |"
        )

    lines += [
        "",
        "## Fork 的上游项目",
        "",
        "> Fork 通常是参考实现或上游依赖，不是自研代码。",
        "",
        "| 仓库 | 语言 | 最近推送 | 描述 |",
        "|---|---|---|---|",
    ]
    for r in forks:
        lines.append(
            f"| [`{r['name']}`]({r['url']}) | {lang(r)} "
            f"| {(r.get('pushedAt') or '—')[:10]} | {clean(r.get('description'))} |"
        )

    langs = {}
    for r in repos:
        langs[lang(r)] = langs.get(lang(r), 0) + 1
    top = sorted(langs.items(), key=lambda t: -t[1])

    lines += [
        "",
        "## 按语言分布",
        "",
        "| 语言 | 仓库数 |",
        "|---|---|",
    ]
    for name, n in top:
        lines.append(f"| {name} | {n} |")

    lines.append("")
    (outdir / "INDEX.md").write_text("\n".join(lines), encoding="utf-8")

    # 每个仓库一个详情页，Agent 按需读取
    pdir = outdir / "projects"
    pdir.mkdir(exist_ok=True)
    for r in repos:
        body = [
            f"# {r['name']}",
            "",
            f"- **可见性**：{VIS_LABEL.get(r['visibility'], r['visibility'])}",
            f"- **类型**：{'Fork（上游参考）' if r.get('isFork') else '原创项目'}",
            f"- **主语言**：{lang(r)}",
            f"- **仓库地址**：{r['url']}",
            f"- **创建 / 最近推送**：{(r.get('createdAt') or '—')[:10]} / {(r.get('pushedAt') or '—')[:10]}",
            f"- **Stars / 体积**：{r.get('stargazerCount', 0)} / {r.get('diskUsage', 0)} KB",
            f"- **归档**：{'是' if r.get('isArchived') else '否'}",
            f"- **话题**：{topics(r)}",
            "",
            "## 描述",
            "",
            clean(r.get("description")),
            "",
            "## 本地克隆",
            "",
            "```bash",
            f"gh repo clone {owner}/{r['name']}",
            "```",
            "",
        ]
        (pdir / f"{r['name']}.md").write_text("\n".join(body), encoding="utf-8")

    print(f"生成 {len(repos)} 个详情页 + INDEX.md")


if __name__ == "__main__":
    main()
