# web_fetch 报 `WEB_BLOCKED_URL`：TUN / fake-IP 代理

仓库：<https://github.com/alex-zz7/deepseek-harness>  
本文：<https://github.com/alex-zz7/deepseek-harness/blob/main/docs/web-fetch-fakeip-fix.md>

`web_search`、浏览器、`curl` 都正常，只有 `web_fetch` 对**所有**域名失败：

```
Error: URL hostname "raw.githubusercontent.com" resolves to a non-public IP address
```

一句话原因：本机 DNS 被代理客户端改成 fake-IP，`198.18.0.0/15` 的占位地址被 DSH 的 SSRF 防护当成非公网地址拒掉。直连校验必须留着；修好的办法是让请求走本地 HTTP 代理，由代理解析真实地址。

## 三类环境

| 环境 | DNS 看到什么 | `web_fetch` |
|---|---|---|
| 无代理 | 公网 A 记录 | 直连，正常 |
| 系统 HTTP/SOCKS 代理（未改 DNS） | 公网 A 记录 | 直连或按 `HTTPS_PROXY` 走代理，正常 |
| TUN + fake-IP（Clash / MacPacket / Surge / sing-box / Loon） | `198.18.x.x` | 直连必挂。本仓库会探测回环 HTTP 端口并改走代理；探测不到则改报 `WEB_PROXY_FAKE_IP`，并告诉你怎么配 `~/.dsh/.env` |

不要把 `198.18.0.0/15` 加进 `NO_PROXY`：加了会重新走本机解析，故障复现。

## 排查

macOS 上看系统 DNS 是不是占位地址（不要信 `/etc/resolv.conf`）：

```bash
/usr/sbin/scutil --dns | head -40
# 常见：nameserver 198.18.0.2  if_index utun4
```

对照真地址：

```bash
dig +short raw.githubusercontent.com A
# 命中 fake-IP 时是 198.18.x.x
dig @223.5.5.5 +short raw.githubusercontent.com A
# 对照：185.199.108-111.133
```

本机 HTTP 代理有没有在听：

```bash
/usr/sbin/scutil --proxy
lsof -nP -iTCP:1082 -sTCP:LISTEN
# 常见端口：7890 7891 7897 7899 1080 1082 6152 8888
```

## 修法

**自动（本仓库）**：`npm start` 和插件启动时，若环境里还没有 `HTTP_PROXY` / `HTTPS_PROXY`，会在 300ms 内探测回环端口（并优先信 `scutil --proxy`）。找到就设代理并打一行：

```
detected local proxy at 127.0.0.1:PORT, routing harness egress through it
```

关掉：`DSH_PROXY_AUTODETECT=0`。只信任回环，不会去连远程代理。

**手写（探测失败时）**：`~/.dsh/.env`（必须是 Harness home，项目级 `.env` 里写代理变量会被启动器拒绝）：

```dotenv
HTTP_PROXY=http://127.0.0.1:1082
HTTPS_PROXY=http://127.0.0.1:1082
```

然后重启 `dsh web` / `npm start`。代理策略只在启动时装一次。

**或者**关掉客户端的 fake-IP / TUN 增强，改用系统 HTTP 代理。

回退：删掉 `~/.dsh/.env` 里那两行，或设 `DSH_PROXY_AUTODETECT=0`，再重启。没有代理时，`198.18.0.0/15` 仍然拒绝，只是错误码变成 `WEB_PROXY_FAKE_IP`。

## 占位段

| 客户端 | 常见 fake-IP |
|---|---|
| Clash / MacPacket / Surge / Loon / 多数 sing-box | `198.18.0.0/15` |
| sing-box 部分配置 | `198.19.0.0/16`（仍落在 `/15` 里） |
| 其他实现 | 偶见 `240.0.0.0/4`（仍报原来的 `WEB_BLOCKED_URL`，不会误判成 fake-IP） |

`127/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、`::1`、字面量 IP URL 一律仍是 `WEB_BLOCKED_URL`。

## 复现脚本

```bash
node plugins/web-fetch-proxy/test/fake-ip.test.mjs
node plugins/web-fetch-proxy/test/detect.test.mjs
node plugins/web-fetch-proxy/test/probe-fetch.mjs
HTTPS_PROXY=http://127.0.0.1:1082 node plugins/web-fetch-proxy/test/probe-fetch.mjs --live
```

未包一层时：`WEB_BLOCKED_URL`。包了 remap、本机 DNS 仍是 fake-IP、又没走代理时：`WEB_PROXY_FAKE_IP`。配了 `HTTPS_PROXY` 后上述公开 URL 应返回 200。
