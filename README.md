# 优选域名管理面板

Cloudflare Workers DNS 管理器：从多个 IP 接口抓取优选 IP，合并去重并检测 TCP 443，只把通过检测的 IPv4/IPv6 以 DNS only（灰云）记录同步到一个或多个 Cloudflare Zone，同时覆盖根域名和泛解析。

## 功能

- `/` 提供首页，`/admin` 提供管理后台；管理员会话使用签名的 `HttpOnly` Cookie。
- 多 Zone 管理：每个 Zone 配置独立的域名、Zone ID 和可选 API Token。
- 多来源 IP 合并、去重、IPv4/IPv6 过滤；支持手动 IP。
- 所有候选 IP 先做 TCP 443 检测；没有通过项时不会改动现有 DNS。
- DNS Diff Update：只创建新增记录、删除过期记录、保留未变化记录。
- 同步根域名和 `*.域名`，记录固定为 `proxied: false`，避免开启小黄云导致优选 IP 失效。
- Cron 自动同步与管理员手动同步共用 Durable Object 锁。
- 暗黑模式、OpenAPI JSON 文档：`/api/openapi.json`。

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

## 部署

需要 Node.js 18+ 和 Wrangler。

```bash
npm install
npx wrangler login
npx wrangler kv namespace create PDM_KV
```

把命令返回的 KV namespace id 填到 `wrangler.toml` 的 `id`。然后设置必需的 Secret：

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
```

`SESSION_SECRET` 应使用随机长字符串。可以设置一个全局 Cloudflare API Token，也可以在后台为每个 Zone 单独填写 Token：

```bash
npx wrangler secret put CF_API_TOKEN
```

可选的初始单 Zone 配置写在 `wrangler.toml` 的 `[vars]`：

```toml
DEFAULT_DOMAIN = "example.com"
CF_ZONE_ID = "你的 Zone ID"
IP_SOURCES = "https://source-one.example/ips,https://source-two.example/ips"
```

部署：

```bash
npx wrangler deploy
```

## Cloudflare 路由和 DNS

Worker 发布后，在 Worker Routes 中添加：

```text
example.com/*
*.example.com/*
```

根域名与泛域名都必须经过 Worker。Cloudflare Zone 必须处于激活状态，但优选 DNS 记录本身必须保持 DNS only（灰云）；后台同步会强制新建记录为 `proxied: false`，并会把由本管理器维护且误开代理的记录改回灰云。

Cloudflare API Token 至少需要目标 Zone 的 `Zone:Read` 与 `DNS:Edit` 权限。建议为每个 Zone 使用最小权限 Token。

## IP 来源格式

来源接口可以返回纯文本，也可以返回 JSON。程序会递归提取其中的 IPv4/IPv6 字符串，例如：

```text
1.1.1.1
2606:4700:4700::1111
```

或：

```json
{"data":["1.1.1.1", "2606:4700:4700::1111"]}
```

## 本地开发

在 `.dev.vars` 中填写：

```dotenv
ADMIN_PASSWORD=change-me
SESSION_SECRET=local-development-secret
CF_API_TOKEN=optional-token
DEFAULT_DOMAIN=example.com
CF_ZONE_ID=optional-zone-id
```

再运行：

```bash
npm run dev
```

本地开发仍建议使用测试 Zone。TCP 443 探测依赖 Workers 的 `cloudflare:sockets` 能力；在本地模拟器中不可用时，预览/同步会把无法连接的地址过滤掉。

## API 摘要

登录后可调用：

- `GET /api/config` / `PUT /api/config`：读取/保存多 Zone、来源和手动 IP。
- `POST /api/ips/preview`：抓取来源、合并并执行 TCP 443 检测。
- `POST /api/sync`：执行 Diff Update，可传 `{ "zoneId": "..." }` 只同步一个 Zone。
- `POST /api/auth/logout`：注销会话。

完整 OpenAPI 文档见 `/api/openapi.json`。

## GitHub 自动部署到 Cloudflare

仓库已内置两个 GitHub Actions：

- `.github/workflows/ci.yml`：Pull Request 和非 `main` 分支执行 `npm ci`、类型检查及 Wrangler dry-run。
- `.github/workflows/deploy.yml`：推送到 `main` 或手动运行时，自动部署到 Cloudflare Workers。

### 1. 创建 Cloudflare API Token

在 Cloudflare Dashboard → My Profile → API Tokens 创建 Token，至少授予：

- Account → Workers Scripts → Edit
- Account → Workers KV Storage → Edit
- Account → Account Settings → Read（Wrangler 通常需要读取账户信息）

如果希望 Worker 能同步 DNS，Token 还需要目标 Zone 的 `Zone:Read` 和 `DNS:Edit`。建议使用专用 Token，并限制到目标账户/Zone。

### 2. 创建 KV Namespace

本地执行：

```bash
npx wrangler kv namespace create PDM_KV
```

记录返回的 namespace ID。不要提交真实的 API Token；KV ID 可以放入 GitHub Secret，由部署工作流注入。

### 3. 配置 GitHub Secrets

在 GitHub 仓库 Settings → Secrets and variables → Actions → New repository secret 添加：

| Secret | 内容 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | 上一步创建的 Cloudflare API Token |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Account ID |
| `PDM_KV_NAMESPACE_ID` | `wrangler kv namespace create PDM_KV` 返回的 ID |
| `PDM_ADMIN_PASSWORD` | 管理后台登录密码 |
| `PDM_SESSION_SECRET` | 随机长字符串，用于签名 HttpOnly Cookie |
| `PDM_CF_API_TOKEN` | Worker 运行时调用 DNS API 的 Token，可与部署 Token 相同 |

其中 `CLOUDFLARE_ACCOUNT_ID` 可在 Cloudflare Dashboard 的 Workers & Pages 概览或账户 URL 中找到。

### 4. 配置 Worker 变量

部署工作流会把 `PDM_ADMIN_PASSWORD`、`PDM_SESSION_SECRET` 和可选的 `PDM_CF_API_TOKEN` 写入 Worker Secret，不会把运行时密码写入仓库。也可以在 Cloudflare Dashboard → Workers & Pages → 对应 Worker → Settings → Variables and Secrets 中手动设置：

```bash
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET
npx wrangler secret put CF_API_TOKEN
```

也可以在 Cloudflare Dashboard → Workers & Pages → 对应 Worker → Settings → Variables and Secrets 中设置。`DEFAULT_DOMAIN`、`CF_ZONE_ID`、`IP_SOURCES` 等非敏感初始配置可放在 `wrangler.toml` 的 `[vars]`，然后提交到 GitHub。

### 5. 触发部署

提交并推送到 `main`：

```bash
git add .
git commit -m "deploy worker"
git push origin main
```

也可以在 GitHub Actions 页面手动运行 `Deploy to Cloudflare Workers`。工作流会在部署前将 `PDM_KV_NAMESPACE_ID` 注入 `wrangler.toml`，不会修改仓库中的占位符文件。
