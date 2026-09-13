#!/usr/bin/env python3
"""Inline lib/dicts.json into lib/client.js as const DICTS = ..."""

from pathlib import Path
import json
import re

root = Path(__file__).resolve().parents[1]
dicts_path = root / "lib" / "dicts.json"
chrome_path = root / "lib" / "chrome-dicts.json"
client_path = root / "lib" / "client.js"
text = client_path.read_text(encoding="utf-8")
merged = {}
for extra in (chrome_path, dicts_path):
    if not extra.exists():
        continue
    data = json.loads(extra.read_text(encoding="utf-8"))
    for lang, namespaces in data.items():
        dest = merged.setdefault(lang, {})
        dest.update(namespaces)
payload = json.dumps(merged, ensure_ascii=False, indent=2) if merged else "{}"
payload = payload.replace("\n", "\n    ")
# Splice by span — re.sub would interpret \n / \\ inside the JSON payload.
pat = re.compile(r"const DICTS = (?:\{}|\{[\s\S]*?\n    \});")
match = pat.search(text)
if not match:
    raise SystemExit("embed-dicts: expected one DICTS assignment, found 0")
client_path.write_text(
    text[: match.start()] + f"const DICTS = {payload};" + text[match.end() :],
    encoding="utf-8",
)
print(f"embedded {len(merged)} languages into {client_path}")
