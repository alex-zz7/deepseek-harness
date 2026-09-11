#!/usr/bin/env python3
"""为 skill 副本生成分组索引。

用法: gen-skill-index.py <vault目录> <输出目录> [隔离清单]
"""
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


def read_description(skill_md: Path):
    """取 SKILL.md 的 YAML frontmatter description，退化为首个非标题行。"""
    try:
        text = skill_md.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return "—"
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
    if m:
        fm = m.group(1)
        dm = re.search(
            r"^description:\s*(.*?)(?=^\w+:\s|\Z)", fm, re.S | re.M
        )
        if dm:
            desc = " ".join(dm.group(1).split()).strip("'\"")
            return desc[:220] + ("…" if len(desc) > 220 else "")
    for line in text.splitlines():
        s = line.strip()
        if s and not s.startswith(("#", "---", ">")):
            return s[:220]
    return "—"


def main():
    vault = Path(sys.argv[1])
    outdir = Path(sys.argv[2])
    quar = Path(sys.argv[3]) if len(sys.argv) > 3 else None

    groups = defaultdict(list)
    for skill_md in sorted(vault.rglob("SKILL.md")):
        rel_parts = skill_md.relative_to(vault).parts
        group = rel_parts[0] if len(rel_parts) > 1 else "未分类"
        name = skill_md.parent.name
        n_refs = len(list((skill_md.parent / "references").rglob("*.md"))) \
            if (skill_md.parent / "references").is_dir() else 0
        groups[group].append((name, skill_md.relative_to(vault), n_refs,
                              read_description(skill_md)))

    total = sum(len(v) for v in groups.values())
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    lines = [
        "# Skill 知识库索引",
        "",
        f"> 自动生成于 {stamp}，共 **{total}** 个 skill，分 {len(groups)} 组。",
        ">",
        "> 重新生成：`./knowledge/scripts/sync-skills.sh`",
        "",
        "## Agent 使用说明",
        "",
        "1. **先在本索引定位 skill 名**，再读它的 `SKILL.md`，不要全库扫描。",
        "2. 需要细节时再读同目录 `references/` 下的文件。",
        "3. skill 根目录通常在 `vault/<分类>/<skill名>/`。",
        "4. 隔离清单见 `_quarantine.txt`——那些文件含凭据，未复制、需要时回源目录读。",
        "",
    ]

    for group in sorted(groups):
        items = sorted(groups[group])
        lines += [
            f"## {group}（{len(items)}）",
            "",
            "| skill | 参考文档 | 描述 |",
            "|---|---|---|",
        ]
        for name, rel, n_refs, desc in items:
            desc = desc.replace("|", "\\|")
            lines.append(f"| `{name}` | {n_refs} | {desc} |")
        lines.append("")

    if quar and quar.exists():
        flagged = [l for l in quar.read_text().splitlines() if l.strip()]
        if flagged:
            lines += [
                "## 已做凭据打码的文件",
                "",
                f"共 {len(flagged)} 个文件。这些文件里疑似凭据的长串已被替换为 "
                "`***MASKED***`，**键名和正文保留**，因此内容仍然可用。",
                "",
                "需要真实值时，回源目录读：`~/Desktop/skill-knowledge-base/<路径>`。",
                "",
            ]
            lines += [f"- `{p}`" for p in flagged]
            lines.append("")

    (outdir / "INDEX.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"索引 {total} 个 skill / {len(groups)} 组")


if __name__ == "__main__":
    main()
