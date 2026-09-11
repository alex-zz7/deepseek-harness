# knowledge/ — 项目与 skill 知识库

这个目录是 **DeepSeek Harness 工作区内的知识层**，用来回答两类问题：

1. **"我的 GitHub 上都有什么项目？"** → `github/`
2. **"做某件事该用哪个 skill / 它怎么规定的？"** → `skills/`

它和 `mac/`（macOS 原生壳源码）共处同一个 git 仓库，但两者互不干扰。

## 目录结构

```
knowledge/
├── INDEX.md              # 总入口：先读这个
├── README.md             # 本文件
├── github/
│   ├── INDEX.md          # 32 个仓库总表（原创 17 / Fork 15）
│   └── projects/*.md     # 每仓库一页元数据
├── skills/
│   ├── INDEX.md          # 252 个 skill 分类索引 + 描述
│   ├── _quarantine.txt   # 已打码文件清单
│   └── vault/<分类>/<skill>/   # skill 正文副本（2232 个 md，约 19MB）
└── scripts/
    ├── sync-github.sh    # 重新拉取 GitHub 仓库索引
    ├── sync-skills.sh    # 重新同步 skill 副本
    ├── gen-github-index.py
    └── gen-skill-index.py
```

## Agent 路由规则（重要）

**不要全库扫描。** 按这个顺序收敛：

| 用户问什么 | 先读 | 再读 |
|---|---|---|
| "我有哪些项目 / 某项目是干嘛的" | `github/INDEX.md` | `github/projects/<名字>.md` |
| "某项目源码怎么实现" | 确认本地是否已克隆 | 没有则 `gh repo clone alex-zz7/<名字>` |
| "做 SEO / 写博客 / 发 App Store" | `skills/INDEX.md` 定位 skill 名 | `skills/vault/<分类>/<skill>/SKILL.md` |
| "某 skill 的细节规则" | `skills/vault/<分类>/<skill>/SKILL.md` | 同目录 `references/*.md` |

搜索技巧：`grep -ril "关键词" knowledge/skills/INDEX.md` 先定位，再只读那一个 skill。

## 维护

```bash
# 刷新 GitHub 仓库索引（需要 gh 已登录）
./knowledge/scripts/sync-github.sh alex-zz7

# 重新同步 skill（从 ~/Desktop/skill-knowledge-base 拉取）
./knowledge/scripts/sync-skills.sh

# 指定其他源目录
./knowledge/scripts/sync-skills.sh /path/to/other/skills
```

两个脚本都幂等：重跑只会覆盖生成物，不会碰手写文件。

## 数据来源与安全

- **GitHub 索引**：来自 `gh repo list`，只含元数据（描述、语言、时间、话题），**不含任何源码或密钥**。
- **Skill 副本**：从 `~/Desktop/skill-knowledge-base`（249 个去重 skill 的快照）同步而来，只收文本类文件（`*.md`），跳过图片、模板工程、二进制。
- **凭据处理**：同步时会扫描 `api_key` / `token` / `cookie` / `secret` 等模式，命中的长串值替换为 `***MASKED***`，键名和正文保留。当前有 14 个文件被处理过，清单在 `skills/_quarantine.txt`。需要真实值时**回源目录读**，不要从这个仓库读。

> ⚠️ **提交前必读**：这个目录用的是"打码而非删除"策略，打码基于正则，**不能保证 100% 覆盖**。推送到公开远程仓库前，务必再跑一次人工核对：
> ```bash
> grep -rlEi '(api[_-]?key|secret|password|cookie|token)["'"'"' :=]{1,4}[A-Za-z0-9]{24,}' knowledge/
> ```
> 更稳的做法：`knowledge/skills/vault/` 加入 `.gitignore`，只提交两个 `INDEX.md`（索引足够 Agent 路由，正文回本地源目录读）。

## 为什么不与 Obsidian 耦合

Obsidian 是给人看的 Markdown 编辑器（双链、图谱），需要下载安装并指定 Vault。而 **Agent 读的是一个文件夹，不是那个 App**：

- DSH 用 `glob` 找文件、`grep` 搜内容、`read` 读全文 —— 对普通文件夹和 Obsidian Vault 完全等价。
- 本目录刻意**不含 `.obsidian/`**，保持为纯文件夹，避免配置和缓存污染检索结果。
- 想用 Obsidian 当人机界面？直接把这个目录（或其父目录）作为 Vault 打开即可，不需要任何转换。**但不要把它当云盘"上传"——Obsidian 没有上传这一步，文件始终在本地。**
