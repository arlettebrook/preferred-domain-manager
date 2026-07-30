# 优选域名管理面板

Cloudflare Workers DNS 管理器：从多个 IP 接口抓取优选 IP，合并去重并检测 TCP 443，只把通过检测的 IPv4/IPv6 以 DNS only（灰云）记录同步到一个默认 Cloudflare Zone，同时覆盖根域名和泛解析。

## 功能

- `/` 首页、`/admin` 管理后台，管理员会话使用签名的 `HttpOnly` Cookie。
- 单 Zone 管理，通过 `DEFAULT_DOMAIN`、`CF_ZONE_ID` 和 `CF_API_TOKEN` 管理目标域名。
- 多来源 IP 合并、去重、IPv4/IPv6 过滤，支持手动 IP。
- 所有候选 IP 先做 TCP 443 检测；没有通过项时不会改动现有 DNS。
- DNS Diff Update，只创建新增记录、删除过期记录、保留未变化记录。
- DNS 编辑仅允许默认域名和 `*.默认域名` 两个名称，并仅允许 `A`、`AAAA`、`CNAME` 三种类型；保存 CNAME 时会自动删除同名的 A/AAAA 记录。
- DNS TTL 固定为标准账户兼容的最低值 `60` 秒，前端显示“最低（60 秒）”，接口也不允许修改。Enterprise 账户可能支持更低值，但本项目默认不使用 30 秒以下的 TTL。
- 同步根域名和 `*.域名`，记录固定为 `proxied: false`，避免开启小黄云导致优选 IP 失效。
- Cron 自动同步与管理员手动同步共用 Durable Object 锁。
- 暗黑模式。
- Telegram Bot DNS 管理：白名单用户可通过内联键盘查看、新建、修改和删除 DNS 记录，也兼容文本命令。

## 项目结构

```text
src/
├─ worker.ts                     Worker 入口、页面路由和 Cron
├─ api.ts                        管理 API 与配置保存
├─ ui.ts                         首页与管理后台页面
├─ types.ts / config.ts          共享类型和常量
├─ validation.ts / http.ts       输入校验和 HTTP 工具
├─ security/session.ts           HttpOnly Cookie 签名会话
├─ services/settings.ts          KV 配置读写
├─ services/ip-sources.ts        多来源 IP、去重和 TCP 443 探测
├─ services/cloudflare-dns.ts    Cloudflare DNS Diff Update
├─ services/telegram.ts          Telegram Webhook 与 DNS Bot 命令
├─ services/sync.ts              同步编排和 Durable Object 锁
└─ durable-objects/sync-lock.ts  原子同步锁
```

## 通过 Cloudflare Workers 页面连接 GitHub 部署

本项目不使用 GitHub Actions 发布。推荐在 Cloudflare Dashboard 的 Workers & Pages 页面直接连接 GitHub 仓库，由 Cloudflare Workers Builds 负责构建和部署。

### 1. 准备 KV Namespace

可以使用 Wrangler 创建：

```bash
npx wrangler kv namespace create PDM_KV
```

或者在 Cloudflare Dashboard → Storage & databases → KV 中创建 `PDM_KV`。将返回的 namespace ID 填入 [wrangler.toml](wrangler.toml)：

```toml
[[kv_namespaces]]
binding = "PDM_KV"
id = "你的 KV namespace ID"
```

不要保留 `replace-with-your-kv-namespace-id` 占位符。

### 2. 在 Cloudflare 连接 GitHub

进入 Cloudflare Dashboard → Workers & Pages → Create application → Workers → Connect to Git，完成 GitHub 授权后：

1. 选择 GitHub 仓库 `preferred-domain-manager`。
2. 生产分支选择 `main`。
3. Root directory 保持 `/`。
4. Build command 填写 `npm run build`。
5. Deploy command 填写 `npm run deploy`。
6. 保存并部署。

`npm run build` 会执行 TypeScript 类型检查；`npm run deploy` 会由 Cloudflare Workers Builds 调用 Wrangler 发布 Worker。后续推送到 `main` 时，Cloudflare 会按照该连接配置进行构建和发布，不需要 GitHub Actions，也不需要把 Cloudflare API Token 放进 GitHub Secrets。

如果 Cloudflare 的构建设置没有自动安装 npm 依赖，可将 Build command 改为：

```bash
npm ci && npm run build
```

### 3. 配置 Worker Secrets 和变量

部署成功后，进入 Cloudflare Dashboard → Workers & Pages → 对应 Worker → Settings → Variables and Secrets，添加：

Secrets：

| 名称 | 说明 |
| --- | --- |
| `ADMIN_PASSWORD` | 管理后台登录密码 |
| `SESSION_SECRET` | 随机长字符串，用于签名 HttpOnly Cookie |

Cloudflare API Token、默认域名、Zone ID 和 IP 来源不需要添加到 Workers Variables/Secrets；本项目会在 `/admin` 的“全局设置”中保存到 KV。Cloudflare API Token 至少需要目标 Zone 的 `Zone:Read` 和 `DNS:Edit` 权限。

不要把 `DEFAULT_DOMAIN`、`CF_ZONE_ID`、`CF_API_TOKEN` 或 `IP_SOURCES` 写入仓库、`wrangler.toml` 或 `.dev.vars`；这些值只能在 `/admin` 页面保存到 KV。

部署后也可以直接打开 `/admin`，在“全局设置”区域编辑：

- `CF_API_TOKEN`：Cloudflare DNS API Token。输入框不会回显已保存的 Token，留空表示保持原值。
- `DEFAULT_DOMAIN`：默认域名，例如 `example.com`。
- `CF_ZONE_ID`：Cloudflare Zone ID。
- `IP_SOURCES`：在“IP 来源”区域逐条添加、编辑或删除来源地址。
- Telegram Bot Token、Webhook Secret 和 Telegram 用户 ID 白名单：在“Telegram Bot”区域编辑。Token 和 Secret 留空表示保持原值。

面板保存的配置写入 KV，并优先于 Wrangler 初始变量。`DEFAULT_DOMAIN + CF_ZONE_ID` 始终作为同步目标。全局 Token 只返回“已配置”状态，不会通过管理 API 返回明文。

### Telegram Bot DNS 管理

1. 在 Telegram 中联系 `@BotFather`，使用 `/newbot` 创建 Bot 并复制 Bot Token。
2. 获取自己的 Telegram 数字用户 ID（可使用可信的 ID 查询 Bot），不要填写用户名或群组名称。
3. 登录 `/admin` → “全局设置” → “Telegram Bot”，填写 Bot Token、随机 Webhook Secret 和允许操作的用户 ID，每行一个。
4. 点击“保存 Telegram 设置”，再点击“测试 Bot”确认 Token 有效。
5. 点击“设置 Webhook”。系统会自动设置 Webhook 和 Telegram 菜单命令，并使用当前 Worker 地址的 `https://你的域名/telegram/webhook`。也可以单独点击“同步菜单命令”。如果之前已经设置过 Webhook，升级版本后需要重新点击一次以启用按钮回调。

Webhook 必须能够通过 Cloudflare Worker Route 访问；如果使用自定义域名，请确保该域名的 Worker 路由已经生效。需要停用时点击“删除 Webhook”。

打开 Bot 后可直接使用内联键盘：DNS 类型、域名、内容和 TTL 使用 Telegram 等宽代码格式，点击代码文本即可复制；DNS 列表按序号显示，点击序号进入对应记录编辑；编辑和删除也支持 `/edit 序号`、`/delete 序号`。完整编辑可以重新选择类型、根域名/泛域名并输入内容；添加记录会依次选择类型、根域名/泛域名，再输入内容；删除必须二次确认。

同时支持以下命令：

```text
/start 或 /help
/dns 或 /dns list
/dns add A example.com 1.1.1.1
/dns add AAAA '*.example.com' 2606:4700:4700::1111
/dns add CNAME example.com target.example.net
/dns update <记录ID> <类型> <域名> <内容>
/dns delete <记录ID>
/cancel
```

Telegram 菜单会显示 `/start`、`/dns`、`/add`、`/edit`、`/delete`、`/help` 和 `/cancel`。发送 `/dns` 后，记录按当前页从 1 开始编号；例如发送 `/edit 2` 编辑第二条，发送 `/delete 2` 删除第二条。序号选择状态保存 10 分钟，刷新或翻页后应使用最新页面中的序号。

Bot 与管理面板共用 DNS 规则：只能操作默认域名和 `*.默认域名`，只允许 A、AAAA、CNAME；CNAME 保存时会自动删除同名 A/AAAA，所有记录 TTL 固定为最低值 60 秒。未加入白名单的用户不会收到响应。

### 4. 配置 Worker Routes

Worker 发布后，在 Cloudflare Dashboard → Workers & Pages → 对应 Worker → Settings → Domains & Routes 中添加：

```text
example.com/*
*.example.com/*
```

根域名与泛域名都必须经过 Worker。Cloudflare Zone 必须处于激活状态，但优选 DNS 记录本身必须保持 DNS only（灰云）。同步逻辑会强制新建记录为 `proxied: false`，并把由本管理器维护且误开代理的记录改回灰云。

## 本地开发与手动备用部署

需要 Node.js 18+：

```bash
npm ci
npx wrangler login
npm run dev
```

在 `.dev.vars` 中填写：

```dotenv
ADMIN_PASSWORD=change-me
SESSION_SECRET=local-development-secret
```

启动后打开 `/admin`，在“全局设置”区域配置 `DEFAULT_DOMAIN`、`CF_ZONE_ID`、`CF_API_TOKEN`；IP 来源在仪表盘中配置。Telegram Bot 需要在“全局设置”中配置。

如果需要绕过 GitHub 连接直接从本地发布：

```bash
npm run check
npm run deploy
```

## IP 来源格式

来源接口可以返回纯文本，也可以返回 JSON。程序会递归提取其中的 IPv4/IPv6 字符串：

```text
1.1.1.1
2606:4700:4700::1111
```

或：

```json
{"data":["1.1.1.1", "2606:4700:4700::1111"]}
```

## API 摘要

登录后可调用：

- `GET /api/config` / `PUT /api/config`：读取/保存默认域名、Zone、来源和手动 IP。
- `GET /api/dns/records`：读取默认 Zone 的全部 DNS 记录。
- `POST /api/dns/records`：新建 DNS 记录。
- `PUT /api/dns/records/:id`：编辑 DNS 记录。
- `DELETE /api/dns/records/:id`：删除 DNS 记录。
- `POST /api/ips/preview`：抓取来源、合并并执行 TCP 443 检测。
- `POST /api/sync`：执行默认 Zone 的 DNS Diff Update。
- `POST /api/auth/logout`：注销会话。
- `POST /api/telegram/test`：测试 Telegram Bot Token。
- `POST /api/telegram/webhook` / `DELETE /api/telegram/webhook`：设置或删除 Telegram Webhook。
- `POST /api/telegram/commands`：同步 Telegram Bot 菜单命令。
- `POST /telegram/webhook`：Telegram 回调入口，由 Telegram 调用，不需要管理员 Cookie。

后台的“全局设置”区域提供独立的“保存设置”按钮；DNS 编辑页面支持搜索、刷新、新建、编辑和删除。DNS 记录名称限定为默认域名和泛域名，类型限定为 A、AAAA、CNAME，TTL 固定为“最低（60 秒）”。标记为“优选托管”的记录会被下一次优选 IP 同步重新校正。
