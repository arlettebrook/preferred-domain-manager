import { HttpError } from "../errors";
import { createDnsRecord, deleteDnsRecord, listDnsRecords, updateDnsRecord } from "./cloudflare-dns";
import { getSettings } from "./settings";
import { DnsRecord, Env, Settings } from "../types";

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 3900;

interface TelegramMessage {
  chat?: { id: number };
  from?: { id: number; username?: string };
  text?: string;
}

interface TelegramUpdate {
  message?: TelegramMessage;
}

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

function targetFromSettings(settings: Settings) {
  if (!settings.defaultDomain || !settings.cfZoneId) throw new HttpError(400, "后台尚未配置默认域名和 Zone ID");
  return { domain: settings.defaultDomain, zoneId: settings.cfZoneId };
}

function allowed(settings: Settings, userId: number) {
  return (settings.telegramAllowedUserIds ?? []).includes(String(userId));
}

async function telegramApi<T>(settings: Settings, method: string, body: Record<string, unknown>) {
  if (!settings.telegramBotToken) throw new HttpError(400, "尚未配置 Telegram Bot Token");
  const response = await fetch(`${TELEGRAM_API}/bot${settings.telegramBotToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json<TelegramResponse<T>>();
  if (!response.ok || !result.ok) throw new HttpError(response.status || 502, result.description || "Telegram API 请求失败");
  return result.result;
}

async function sendMessage(settings: Settings, chatId: number, text: string) {
  for (let index = 0; index < text.length; index += MAX_MESSAGE_LENGTH) {
    await telegramApi(settings, "sendMessage", { chat_id: chatId, text: text.slice(index, index + MAX_MESSAGE_LENGTH), disable_web_page_preview: true });
  }
}

function helpText() {
  return [
    "优选域名管理 Bot",
    "",
    "/dns 或 /dns list  查看默认域名记录",
    "/dns add A <域名> <IPv4>  新增 A",
    "/dns add AAAA <域名> <IPv6>  新增 AAAA",
    "/dns add CNAME <域名> <目标>  新增 CNAME",
    "/dns update <记录ID> <类型> <域名> <内容>  修改记录",
    "/dns delete <记录ID>  删除记录",
    "",
    "域名只允许默认域名和 *.默认域名；TTL 固定为最低值。新增 CNAME 会自动删除同名 A/AAAA。",
  ].join("\n");
}

function recordLines(records: DnsRecord[]) {
  if (!records.length) return "没有找到默认域名或泛域名记录。";
  return records.map((record) => `${record.id}\n${record.type} ${record.name}\n${record.content}\nTTL: ${record.ttl ?? "-"} | ${record.proxied ? "橙云" : "灰云"}`).join("\n\n");
}

function parseCommand(text: string) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const command = parts.shift()?.replace(/^\//, "").split("@", 1)[0].toLowerCase();
  if (command === "dns") return parts;
  return [command || "help", ...parts];
}

function filteredRecords(records: DnsRecord[], domain: string) {
  const names = new Set([domain, `*.${domain}`]);
  return records.filter((record) => names.has(record.name) && ["A", "AAAA", "CNAME"].includes(record.type));
}

export async function handleTelegramWebhook(request: Request, env: Env) {
  const settings = await getSettings(env);
  if (!settings.telegramBotToken || !settings.telegramWebhookSecret) return new Response("Not configured", { status: 404 });
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!secret || secret !== settings.telegramWebhookSecret) return new Response("Forbidden", { status: 403 });
  let update: TelegramUpdate;
  try { update = await request.json<TelegramUpdate>(); } catch { return new Response("Bad Request", { status: 400 }); }
  const message = update.message;
  if (!message?.chat || !message.from || !message.text) return new Response("ok");
  if (!allowed(settings, message.from.id)) return new Response("ok");

  try {
    const target = targetFromSettings(settings);
    const args = parseCommand(message.text);
    const command = args[0]?.toLowerCase() || "list";
    if (command === "help" || command === "start") {
      await sendMessage(settings, message.chat.id, helpText());
    } else if (command === "list" || command === "ls" || command === "refresh") {
      const records = filteredRecords(await listDnsRecords(target, env, settings.cfApiToken), target.domain);
      await sendMessage(settings, message.chat.id, recordLines(records));
    } else if (command === "add" && args.length >= 4) {
      const record = await createDnsRecord(target, { type: args[1], name: args[2], content: args.slice(3).join(" ") }, env, settings.cfApiToken);
      await sendMessage(settings, message.chat.id, `新增成功\n${record.id}\n${record.type} ${record.name}\n${record.content}`);
    } else if (command === "update" && args.length >= 5) {
      const record = await updateDnsRecord(target, args[1], { type: args[2], name: args[3], content: args.slice(4).join(" ") }, env, settings.cfApiToken);
      await sendMessage(settings, message.chat.id, `修改成功\n${record.id}\n${record.type} ${record.name}\n${record.content}`);
    } else if (command === "delete" && args.length === 2) {
      await deleteDnsRecord(target, args[1], env, settings.cfApiToken);
      await sendMessage(settings, message.chat.id, `删除成功：${args[1]}`);
    } else {
      await sendMessage(settings, message.chat.id, helpText());
    }
  } catch (error) {
    await sendMessage(settings, message.chat.id, error instanceof Error ? `操作失败：${error.message}` : "操作失败");
  }
  return new Response("ok");
}

export async function setTelegramWebhook(settings: Settings, webhookUrl: string) {
  if (!settings.telegramWebhookSecret) throw new HttpError(400, "请先设置 Telegram Webhook Secret");
  await telegramApi(settings, "setWebhook", { url: webhookUrl, secret_token: settings.telegramWebhookSecret, allowed_updates: ["message"], drop_pending_updates: false });
  return webhookUrl;
}

export async function deleteTelegramWebhook(settings: Settings) {
  await telegramApi(settings, "deleteWebhook", { drop_pending_updates: false });
}

export async function telegramBotInfo(settings: Settings) {
  return telegramApi<{ id: number; username?: string; first_name?: string }>(settings, "getMe", {});
}
