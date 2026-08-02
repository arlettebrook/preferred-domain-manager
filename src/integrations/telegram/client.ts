import { HttpError } from "../../errors";
import { Settings } from "../../types";

const TELEGRAM_API = "https://api.telegram.org";

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

export async function telegramApi<T>(settings: Settings, method: string, body: Record<string, unknown>) {
  if (!settings.telegramBotToken) throw new HttpError(400, "尚未配置 Telegram Bot Token");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch(`${TELEGRAM_API}/bot${settings.telegramBotToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new HttpError(502, "Telegram 服务暂时不可用或请求超时");
  } finally {
    clearTimeout(timeout);
  }
  const result = await response.json<TelegramResponse<T>>();
  if (!response.ok || !result.ok) throw new HttpError(response.status || 502, result.description || "Telegram API 请求失败");
  return result.result;
}

export async function setTelegramWebhook(settings: Settings, webhookUrl: string) {
  if (!settings.telegramWebhookSecret) throw new HttpError(400, "请先设置 Telegram Webhook Secret");
  await setTelegramCommands(settings);
  await telegramApi(settings, "setWebhook", {
    url: webhookUrl,
    secret_token: settings.telegramWebhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  return webhookUrl;
}

export async function setTelegramCommands(settings: Settings) {
  await telegramApi(settings, "setMyCommands", {
    commands: [
      { command: "start", description: "打开主菜单" },
      { command: "dns", description: "查看 DNS 记录" },
      { command: "add", description: "新增 DNS 记录" },
      { command: "edit", description: "编辑 DNS 记录" },
      { command: "delete", description: "删除 DNS 记录" },
      { command: "update", description: "更新唯一 DNS 记录" },
      { command: "help", description: "查看帮助" },
      { command: "cancel", description: "取消当前操作" },
    ],
  });
  return true;
}

export async function deleteTelegramWebhook(settings: Settings) {
  await telegramApi(settings, "deleteWebhook", { drop_pending_updates: false });
}

export async function telegramBotInfo(settings: Settings) {
  return telegramApi<{ id: number; username?: string; first_name?: string }>(settings, "getMe", {});
}
