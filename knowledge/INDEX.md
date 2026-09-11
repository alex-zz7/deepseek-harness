# 知识库总索引

DeepSeek Harness 工作区（`~/Desktop/deepseekharness`）的知识层入口。

**先读本文件，再按下面的路由表深入。不要全库扫描。**

| 入口 | 内容 | 规模 |
|---|---|---|
| [`github/INDEX.md`](github/INDEX.md) | 我的 GitHub 仓库总表 | 32 个仓库（原创 17 / Fork 15） |
| [`github/projects/`](github/projects/) | 每个仓库一页元数据 | 32 个详情页 |
| [`skills/INDEX.md`](skills/INDEX.md) | 本机 skill 知识库分类索引 | 252 个 skill / 12 组 |
| [`skills/vault/`](skills/vault/) | skill 正文副本 | 2232 个 md，约 19MB |
| [`docs/INDEX.md`](docs/INDEX.md) | 后加的手写文档（说明书、纪要） | 往这里丢 |
| [`README.md`](README.md) | 维护说明与安全策略 | — |

## 路由表

| 你想问 | 去哪 |
|---|---|
| 我有哪些项目？某个项目是干嘛的？ | `github/INDEX.md` → `github/projects/<名字>.md` |
| 某个项目的代码怎么写的？ | 先看 `github/projects/<名字>.md` 确认，再 `gh repo clone alex-zz7/<名字>` |
| Blog / SEO / GEO 相关怎么做？ | `skills/INDEX.md` 找 `05-博客写作包`、`06-SEO-GEO-本地` |
| App Store 上架流程？ | `skills/INDEX.md` 找 `04-App-Store-iOS` |
| 视频 / PPT / 设计？ | `skills/INDEX.md` 找 `07-视频-PPT-设计` |
| Cloudflare / 支付集成？ | `skills/INDEX.md` 找 `09-Cloudflare-工程`、`10-支付-Dodo` |
| 某个 skill 的完整规则？ | `skills/vault/<分类>/<skill名>/SKILL.md` |
| 某份说明书 / 纪要 / 后加的文档？ | `docs/INDEX.md` → 对应文件 |

## 快速检索

```bash
# 在 skill 索引里定位关键词（先做这一步，不要直接 grep vault）
grep -i "关键词" knowledge/skills/INDEX.md

# 在仓库索引里找项目
grep -i "关键词" knowledge/github/INDEX.md

# 后加的手写文档
grep -i "关键词" knowledge/docs/INDEX.md

# 只有在需要细节时才扫正文
grep -rl "关键词" knowledge/skills/vault/
```

## Skill 分类分布

| 分类 | skill 数 |
|---|---|
| 01-sent2x-增长 | 12 |
| 02-alexsignal-博客 | 1 |
| 03-小红书-内容 | 4 |
| 04-App-Store-iOS | 17 |
| 05-博客写作包 | 34 |
| 06-SEO-GEO-本地 | 81 |
| 07-视频-PPT-设计 | 48 |
| 08-浏览器-自动化 | 13 |
| 09-Cloudflare-工程 | 13 |
| 10-支付-Dodo | 15 |
| 11-skill工具 | 2 |
| 12-其他 | 8 |

## 数据新鲜度

| 数据集 | 生成方式 | 刷新命令 |
|---|---|---|
| GitHub 仓库索引 | `gh repo list alex-zz7` | `./knowledge/scripts/sync-github.sh` |
| Skill 副本与索引 | 从 `~/Desktop/skill-knowledge-base` 同步 | `./knowledge/scripts/sync-skills.sh` |
| 手写文档 | 直接放进 `docs/`，并改 `docs/INDEX.md` | 无脚本 |

## 安全边界

- 本目录**不含源码、不含真实密钥**。GitHub 部分只有元数据；skill 部分已做凭据打码（14 个文件，见 `skills/_quarantine.txt`）。
- 打码基于正则，**不保证 100% 覆盖**。推送到公开仓库前请按 `README.md` 的检查清单人工复核，或直接把 `knowledge/skills/vault/` 加入 `.gitignore`。
- 源目录 `~/Desktop/skill-knowledge-base` 含未打码原文，属本机私用，不要整体推送。
