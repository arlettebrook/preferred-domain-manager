# 开发结构

## 目录职责

- `src/main.ts`：Worker 入口，只负责请求分流和定时任务。
- `src/api.ts`：管理端 API 路由与鉴权入口。
- `src/ui/`：页面入口与页面实现。`index.ts` 是统一导出入口，`pages.ts` 负责统一导出，`landing-page.ts` 和 `admin-page.ts` 分别实现落地页与管理页模板。
- `src/services/`：应用服务，例如 DNS、Telegram、设置、IP 来源和同步任务。
- `src/integrations/`：外部平台客户端，例如 `cloudflare/client.ts` 负责 Cloudflare API 通信。
- `src/security/`：会话和安全相关逻辑。
- `src/durable-objects/`：Durable Object 实现。
- `src/validation.ts`、`src/types.ts`：跨模块复用的校验函数和类型。
- `scripts/`：本地开发检查脚本。

## 常用命令

```bash
npm run dev
npm run typecheck
npm run check:ui
npm run check
npm run deploy
```

## 修改建议

1. 页面模板、样式或浏览器脚本只修改 `src/ui/`，不要把页面逻辑放回 `main.ts`。
2. 新的外部 API 请求放到 `src/integrations/`，业务服务只处理业务规则和错误转换。
3. DNS 的新增、编辑、删除和泛记录同步统一经过 `src/services/cloudflare-dns.ts`，不要在 API 或 Telegram 层直接调用 Cloudflare。
4. 修改内嵌管理页脚本后先运行 `npm run check:ui`，再运行 `npm run check`。
