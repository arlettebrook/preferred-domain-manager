export const openApiDocument = {
  openapi: "3.0.3",
  info: { title: "优选域名管理面板 API", version: "1.0.0", description: "Cloudflare Workers DNS 优选 IP 管理接口。管理接口使用 HttpOnly Cookie 会话。" },
  servers: [{ url: "/" }],
  paths: {
    "/api/auth/login": { post: { summary: "管理员登录", requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["password"], properties: { password: { type: "string" } } } } } }, responses: { "200": { description: "登录成功并设置 HttpOnly Cookie" } } } },
    "/api/config": { get: { summary: "读取配置" }, put: { summary: "保存多 Zone、IP 来源和手动 IP 配置" } },
    "/api/ips/preview": { post: { summary: "抓取、合并并 TCP 443 检测优选 IP" } },
    "/api/sync": { post: { summary: "执行 DNS Diff Update", requestBody: { content: { "application/json": { schema: { type: "object", properties: { zoneId: { type: "string" } } } } } } } },
  },
};

