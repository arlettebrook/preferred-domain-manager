import { handleApi } from "./api";
import { HttpError } from "./errors";
import { html, json } from "./http";
import { adminPage, landingPage } from "./ui";
import { Env } from "./types";
import { SyncLock } from "./durable-objects/sync-lock";
import { handleTelegramWebhook } from "./services/telegram";
import { effectiveAdminPath, effectiveHomeRedirect, getSettings } from "./services/settings";

export { SyncLock };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/telegram/webhook" && request.method === "POST") return await handleTelegramWebhook(request, env);
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env);
      const settings = await getSettings(env);
      const adminPath = effectiveAdminPath(settings);
      const requestPath = url.pathname.replace(/\/+$/, "") || "/";
      if (requestPath === adminPath) return html(adminPage());
      if (requestPath !== "/") return Response.redirect(new URL("/", request.url), 302);
      const homeRedirect = effectiveHomeRedirect(settings);
      if (homeRedirect) return Response.redirect(homeRedirect, 302);
      return html(landingPage(url.host, adminPath));
    } catch (error) {
      if (error instanceof HttpError) return json({ error: error.message }, error.status);
      console.error(error);
      return json({ error: "服务器内部错误" }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const stub = env.SYNC_LOCK.get(env.SYNC_LOCK.idFromName("preferred-ip-cron"));
    ctx.waitUntil(stub.fetch("https://probe/cron/start", { method: "POST" }).then(async (response) => {
      if (!response.ok) throw new Error(`scheduled probe start failed: ${response.status} ${await response.text()}`);
    }).catch((error) => console.error("scheduled preferred IP workflow failed", error)));
  },
};
