# 优选域名管理面板

Cloudflare Workers DNS 管理器：从多个 IP 接口抓取优选 IP，合并去重并检测 TCP 443，只把通过检测的 IPv4/IPv6 以 DNS only（灰云）记录同步到一个默认 Cloudflare Zone，同时覆盖根域名和泛解析。

## 功能

- `/` 首页、`/admin` 管理后台，管理员会话使用签名的 `HttpOnly` Cookie。
- 单 Zone 管理，通过 `DEFAULT_DOMAIN`、`CF_ZONE_ID` 和 `CF_API_TOKEN` 管理目标域名。
- 多来源 IP 合并、去重、IPv4/IPv6 过滤，支持手动 IP。
- 所有候选 IP 先做 TCP 443 检测；没有通过项时不会改动现有 DNS。
- DNS Diff Update，只创建新增记录、删除过期记录、保留未变化记录。
- 同步根域名和 `*.域名`，记录固定为 `proxied: false`，避免开启小黄云导致优选 IP 失效。
- Cron 自动同步与管理员手动同步共用 Durable Object 锁。
- 暗黑模式。

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
| `CF_API_TOKEN` | Worker 运行时调用 Cloudflare DNS API 的 Token |

`CF_API_TOKEN` 至少需要目标 Zone 的 `Zone:Read` 和 `DNS:Edit` 权限。

Variables：

```text
DEFAULT_DOMAIN=example.com
CF_ZONE_ID=你的 Zone ID
IP_SOURCES=https://source-one.example/ips,https://source-two.example/ips
```

这些变量也可以写入 `wrangler.toml` 的 `[vars]`，再由 Cloudflare GitHub 部署同步。

部署后也可以直接打开 `/admin`，在“运行变量”区域编辑：

- `CF_API_TOKEN`：全局 Cloudflare DNS API Token。输入框不会回显已保存的 Token，留空表示保持原值。
- `DEFAULT_DOMAIN`：默认域名，例如 `example.com`。
- `CF_ZONE_ID`：默认 Zone ID。
- `IP_SOURCES`：在“IP 来源”区域逐条添加、编辑或删除来源地址。

面板保存的配置写入 KV，并优先于 Wrangler 初始变量。`DEFAULT_DOMAIN + CF_ZONE_ID` 始终作为同步目标。全局 Token 只返回“已配置”状态，不会通过管理 API 返回明文。

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
CF_API_TOKEN=optional-token
DEFAULT_DOMAIN=example.com
CF_ZONE_ID=optional-zone-id
```

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
- `POST /api/ips/preview`：抓取来源、合并并执行 TCP 443 检测。
- `POST /api/sync`：执行默认 Zone 的 DNS Diff Update。
- `POST /api/auth/logout`：注销会话。
