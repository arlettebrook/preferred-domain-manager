# 优选域名管理面板

Cloudflare Workers DNS 管理器：从多个 IP 接口抓取优选 IP，合并去重并检测 TCP 443，只把通过检测的 IPv4/IPv6 以 DNS only（灰云）记录同步到一个默认 Cloudflare Zone，同时覆盖根域名和泛解析。

## 功能

- `/` 首页、`/admin` 管理后台，管理员会话使用签名的 `HttpOnly` Cookie。
- 单 Zone 管理，通过 `DEFAULT_DOMAIN`、`CF_ZONE_ID` 和 `CF_API_TOKEN` 管理目标域名。
- 多来源 IP 合并、去重、IPv4/IPv6 过滤，支持手动 IP。
- 所有候选 IP 先做 TCP 443 检测；没有通过项时不会改动现有 DNS。
- DNS Diff Update，只创建新增记录、删除过期记录、保留未变化记录。
- DNS 编辑会展示当前 Zone 的全部记录；仅允许操作主域名的 `A`、`AAAA`、`CNAME`，其他记录以只读方式展示。编辑保存时会按内容自动识别类型：IPv4 为 A、IPv6 为 AAAA、其他目标为 CNAME。
- DNS TTL 固定为标准账户兼容的最低值 `60` 秒，前端显示“最低（60 秒）”，接口也不允许修改。Enterprise 账户可能支持更低值，但本项目默认不使用 30 秒以下的 TTL。
- 每个域名可独立设置“同步泛域名”开关：开启时主域名变更会自动配对 `*.域名`，关闭时两者独立管理；手动/定时优选 IP 同步和 Telegram 仍会处理根域名与泛域名。记录固定为 `proxied: false`，避免开启小黄云导致优选 IP 失效。
- Cron 可在“全局设置”中启用或关闭；启用后每 30 分钟自动抓取全部候选 IP，通过 Durable Object Alarm 分批完成 TCP 443 检测，保存完整结果后自动同步 DNS。定时同步与管理员手动同步共用锁，避免重复更新。
- 暗黑模式。
- Telegram Bot DNS 管理：白名单用户可通过内联键盘查看、新建、修改和删除 DNS 记录，也兼容文本命令。

## 项目结构

```text
src/
├─ main.ts                       Worker 入口、页面路由和 Cron
├─ api.ts                        管理 API 与配置保存
├─ ui/                           页面入口与管理后台模板
│  ├─ index.ts                   UI 统一导出入口
│  └─ pages.ts                   首页和管理后台页面
├─ integrations/cloudflare/      Cloudflare 外部 API 客户端
├─ services/                     DNS、Telegram、设置、IP 和同步业务
├─ security/session.ts           HttpOnly Cookie 签名会话
├─ types.ts / config.ts          共享类型和常量
├─ validation.ts / http.ts       输入校验和 HTTP 工具
└─ durable-objects/              Durable Object 实现

scripts/                         本地检查脚本
docs/development.md              开发结构与修改指南
```

## 通过 Fork 和 Cloudflare 网页部署

本项目可以完全通过 GitHub 和 Cloudflare 网页部署，不需要本地终端，也不需要配置 GitHub Actions。

### 1. Fork 仓库

打开本项目的 GitHub 页面，点击 **Fork**，选择自己的账号或组织，并保留默认分支 `main`。后续 Cloudflare 应连接这个 Fork，而不是上游仓库。

### 2. 准备 Cloudflare 存储

项目使用 KV 保存管理面板配置，并使用 Durable Objects 执行同步锁和定时检测。请在 Cloudflare Dashboard 的 **Storage & databases → KV** 中创建一个 KV Namespace。

创建后，在 Fork 仓库的 GitHub 网页编辑 [wrangler.toml](wrangler.toml)，将 `PDM_KV` 绑定下的 `id` 改为这个 Namespace 的 ID，然后提交修改。Durable Objects 的绑定和迁移已包含在仓库配置中，无需额外创建。

### 3. 连接 Fork 并部署

在 Cloudflare Dashboard 中进入 **Workers & Pages → Create application → Workers → Connect to Git**，授权 GitHub 后：

1. 选择刚才创建的 Fork 仓库。
2. 生产分支选择 `main`。
3. 根目录保持仓库根目录。
4. 构建设置保持 Cloudflare 自动识别的默认值，不添加自定义命令。
5. 保存并开始部署。

以后只要将修改提交到 Fork 的 `main` 分支，Cloudflare 就会自动重新构建并发布。

### 4. 设置部署环境变量

部署成功后，进入 **Workers & Pages → 对应 Worker → Settings → Variables and Secrets**，在生产环境新增一个 Secret：

| 名称 | 用途 |
| --- | --- |
| `ADMIN_PASSWORD` | `/admin` 管理后台的登录密码 |
| `SESSION_SECRET` | 用于签名管理后台登录会话的随机长字符串 |

请为两个变量都选择 **Secret** 类型并在 Cloudflare 中保存，不要写入仓库文件。`SESSION_SECRET` 应使用与管理员密码不同的随机长字符串。

### 5. 首次访问和网页配置

打开 Cloudflare 分配的 Worker 地址并进入 `/admin`，使用 `ADMIN_PASSWORD` 登录。域名、Zone、Cloudflare API Token、优选 IP 来源、定时任务和 Telegram 等运行参数都在管理后台网页中配置，不需要预先写入环境变量。

如果要使用自己的域名，在 Worker 的 **Settings → Domains & Routes** 中添加域名或路由，并确保对应 Cloudflare Zone 已激活。需要 Telegram Webhook 时，应使用已经指向该 Worker 的 HTTPS 地址。

### Telegram Bot（可选）

Telegram Bot 不是部署必需项。部署完成后，在 `/admin` 的“全局设置 → Telegram Bot”页面填写 Bot Token、Webhook Secret 和允许操作的用户 ID，然后使用页面中的测试与 Webhook 设置按钮完成配置。Webhook 必须通过已经指向该 Worker 的 HTTPS 域名访问。

### 6. 配置自定义域名（可选）

Worker 发布后，可在 Cloudflare Dashboard → Workers & Pages → 对应 Worker → Settings → Domains & Routes 中添加：

```text
example.com/*
*.example.com/*
```

根域名与泛域名都必须经过 Worker。Cloudflare Zone 必须处于激活状态，但优选 DNS 记录本身必须保持 DNS only（灰云）。同步逻辑会强制新建记录为 `proxied: false`，并把由本管理器维护且误开代理的记录改回灰云。

## 优选 API 返回格式

来源接口可以返回纯文本，也可以返回 JSON。程序会递归提取其中的 IPv4/IPv6 字符串，并仅保留端口为 `443` 的地址；未指定端口的 IP 按 `443` 处理，其他端口会被过滤：

```text
1.1.1.1
2606:4700:4700::1111
```

或：

```json
{"data":["1.1.1.1", "2606:4700:4700::1111"]}
```

也支持节点格式，例如 `1.2.3.4:443`、`[2606:4700:4700::1111]:443`；`1.2.3.4:80` 等非 443 端口不会进入优选结果。获取或检测完成后，过滤后的 API IP 会显示在“优选面板”的 API IP 结果区域。

## API 摘要

登录后可调用：

- `GET /api/config` / `PUT /api/config`：读取/保存默认域名、Zone、来源和手动 IP。
- `GET /api/dns/records`：读取当前 Zone 的全部 DNS 记录，并标记可编辑记录。
- `POST /api/dns/records`：新建 DNS 记录。
- `PUT /api/dns/records/:id`：编辑 DNS 记录。
- `DELETE /api/dns/records/:id`：删除 DNS 记录。
- `POST /api/ips/collect`：抓取来源并冻结本次全部候选 IP。
- `POST /api/ips/check-batch`：按安全批次继续执行 TCP 443 检测，直到覆盖全部候选。
- `POST /api/ips/complete`：确认全部候选已经检测并保存完整结果快照。
- `POST /api/sync`：执行当前域名或全部已配置域名的 DNS Diff Update；批量同步会返回每个域名的成功/失败结果，单个域名失败不会阻断其他域名。
- `POST /api/auth/logout`：注销会话。
- `POST /api/telegram/test`：测试 Telegram Bot Token。
- `POST /api/telegram/webhook` / `DELETE /api/telegram/webhook`：设置或删除 Telegram Webhook。
- `POST /api/telegram/commands`：同步 Telegram Bot 菜单命令。
- `POST /telegram/webhook`：Telegram 回调入口，由 Telegram 调用，不需要管理员 Cookie。

后台按“仪表盘 - 优选面板 - DNS 编辑 - 优选配置 - 全局设置”组织功能。优选 API 配置保存不会自动获取 IP；获取和检测统一在优选面板执行。DNS 区域支持搜索、刷新和查看当前 Zone 的全部记录，并对主域名的 A、AAAA、CNAME 提供编辑/删除。DNS 类型限定为 A、AAAA、CNAME，TTL 固定为“最低（60 秒）”。标记为“优选托管”的记录会被下一次优选 IP 同步重新校正。
