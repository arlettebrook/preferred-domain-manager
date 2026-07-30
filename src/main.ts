import { handleApi } from "./api";
import { HttpError } from "./errors";
import { html, json } from "./http";
import { runSync } from "./services/sync";
import { adminPage, landingPage } from "./ui";
import { Env } from "./types";
import { SyncLock } from "./durable-objects/sync-lock";

export { SyncLock };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env);
      if (url.pathname === "/admin" || url.pathname === "/admin/") return html(adminPage());
      return html(landingPage(url.host));
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "服务器内部错误" }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runSync(env).catch((error) => console.error("scheduled sync failed", error)));
  },
};

