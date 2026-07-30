import { HttpError } from "../errors";
import { createDnsRecord, deleteDnsRecord, listDnsRecords, updateDnsRecord } from "./cloudflare-dns";
import { getSettings } from "./settings";
import { DnsRecord, Env, Settings } from "../types";

const TELEGRAM_API = "https://api.telegram.org";
const MAX_MESSAGE_LENGTH = 3900;
const RECORDS_PER_PAGE = 6;
const PENDING_TTL_SECONDS = 10 * 60;
const PENDING_PREFIX = "telegram:pending:";

type RecordType = "A" | "AAAA" | "CNAME";

interface TelegramChat { id: number }

interface TelegramMessage {
  message_id?: number;
  chat?: TelegramChat;
  from?: { id: number; username?: string };
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: { id: number; username?: string };
  data?: string;
  message?: TelegramMessage;
}

interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface TelegramResponse<T> {
  ok: boolean;
  result: T;
  description?: string;
}

interface TelegramButton {
  text: string;
  callback_data: string;
}

interface TelegramReplyMarkup {
  inline_keyboard?: TelegramButton[][];
  force_reply?: boolean;
  selective?: boolean;
}

interface PendingInput {
  kind: "add" | "edit";
  type: RecordType;
  name?: string;
  recordId?: string;
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

async function sendText(settings: Settings, chatId: number, text: string, replyMarkup?: TelegramReplyMarkup) {
  for (let index = 0; index < text.length; index += MAX_MESSAGE_LENGTH) {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: text.slice(index, index + MAX_MESSAGE_LENGTH),
      disable_web_page_preview: true,
    };
    if (replyMarkup && index + MAX_MESSAGE_LENGTH >= text.length) body.reply_markup = replyMarkup;
    await telegramApi(settings, "sendMessage", body);
  }
}

async function editText(settings: Settings, callback: TelegramCallbackQuery, text: string, replyMarkup?: TelegramReplyMarkup) {
  const message = callback.message;
  if (!message?.chat || message.message_id == null) return sendText(settings, callback.from.id, text, replyMarkup);
  const body: Record<string, unknown> = {
    chat_id: message.chat.id,
    message_id: message.message_id,
    text: text.slice(0, MAX_MESSAGE_LENGTH),
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  try {
    await telegramApi(settings, "editMessageText", body);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("message is not modified")) throw error;
  }
}

async function answerCallback(settings: Settings, callback: TelegramCallbackQuery, text?: string) {
  await telegramApi<boolean>(settings, "answerCallbackQuery", {
    callback_query_id: callback.id,
    ...(text ? { text } : {}),
  });
}

function pendingKey(chatId: number, userId: number) {
  return `${PENDING_PREFIX}${chatId}:${userId}`;
}

async function getPending(env: Env, chatId: number, userId: number) {
  return env.PDM_KV.get<PendingInput>(pendingKey(chatId, userId), "json");
}

async function setPending(env: Env, chatId: number, userId: number, value: PendingInput) {
  await env.PDM_KV.put(pendingKey(chatId, userId), JSON.stringify(value), { expirationTtl: PENDING_TTL_SECONDS });
}

async function clearPending(env: Env, chatId: number, userId: number) {
  await env.PDM_KV.delete(pendingKey(chatId, userId));
}

function button(text: string, callbackData: string): TelegramButton {
  return { text, callback_data: callbackData };
}

function homeKeyboard(): TelegramReplyMarkup {
  return { inline_keyboard: [
    [button("📋 DNS 记录", "menu:list"), button("➕ 添加记录", "menu:add")],
    [button("🔄 刷新", "menu:list"), button("❓ 帮助", "menu:help")],
  ] };
}

function backKeyboard(): TelegramReplyMarkup {
  return { inline_keyboard: [[button("↩️ 返回主菜单", "menu:home")]] };
}

function homeText(settings: Settings) {
  const target = settings.defaultDomain && settings.cfZoneId
    ? `当前域名：${settings.defaultDomain}`
    : "当前尚未完成默认域名和 Zone ID 配置";
  return [`优选域名管理 Bot`, target, "", "请选择要执行的操作："].join("\n");
}

function helpText() {
  return [
    "优选域名管理 Bot",
    "",
    "支持内联键盘，也支持以下命令：",
    "/start 或 /help  打开主菜单",
    "/dns 或 /dns list  查看 DNS 记录",
    "/dns add A <域名> <IPv4>",
    "/dns add AAAA <域名> <IPv6>",
    "/dns add CNAME <域名> <目标>",
    "/dns update <记录ID> <类型> <域名> <内容>",
    "/dns delete <记录ID>",
    "",
    "仅允许默认域名和 *.默认域名；仅支持 A、AAAA、CNAME；TTL 固定最低值；CNAME 会自动删除同名 A/AAAA。",
  ].join("\n");
}

function filteredRecords(records: DnsRecord[], domain: string) {
  const names = new Set([domain, `*.${domain}`]);
  return records.filter((record) => names.has(record.name) && ["A", "AAAA", "CNAME"].includes(record.type));
}

function recordText(record: DnsRecord) {
  return `${record.type} ${record.name}\n${record.content}\nTTL：${record.ttl ?? "-"} · ${record.proxied ? "橙云" : "灰云"}`;
}

function recordListText(records: DnsRecord[], page: number, totalPages: number, domain: string) {
  if (!records.length) return `DNS 记录\n\n${domain} 和 *.${domain} 当前没有可管理记录。`;
  return [`DNS 记录（第 ${page + 1}/${totalPages} 页）`, "", ...records.map((record, index) => `${index + 1}. ${recordText(record)}`)].join("\n\n");
}

function recordListKeyboard(records: DnsRecord[], page: number, totalPages: number): TelegramReplyMarkup {
  const rows: TelegramButton[][] = records.map((record) => [
    button(`✏️ ${record.type} ${record.name}`, `edit:${record.id}`),
    button("🗑️ 删除", `delete:${record.id}`),
  ]);
  const navigation: TelegramButton[] = [];
  if (page > 0) navigation.push(button("上一页", `list:${page - 1}`));
  if (page + 1 < totalPages) navigation.push(button("下一页", `list:${page + 1}`));
  if (navigation.length) rows.push(navigation);
  rows.push([button("➕ 添加记录", "menu:add"), button("↩️ 主菜单", "menu:home")]);
  return { inline_keyboard: rows };
}

function typeKeyboard(): TelegramReplyMarkup {
  return { inline_keyboard: [
    [button("A · IPv4", "add:type:A"), button("AAAA · IPv6", "add:type:AAAA")],
    [button("CNAME · 别名", "add:type:CNAME")],
    [button("↩️ 返回主菜单", "menu:home")],
  ] };
}

function nameKeyboard(type: RecordType): TelegramReplyMarkup {
  return { inline_keyboard: [
    [button("根域名", `add:name:${type}:root`), button("泛域名 *", `add:name:${type}:wildcard`)],
    [button("↩️ 返回类型选择", "menu:add")],
  ] };
}

function editTypeKeyboard(recordId: string, currentType: RecordType): TelegramReplyMarkup {
  return { inline_keyboard: [
    [button(`${currentType === "A" ? "✅" : ""} A · IPv4`, `edit:type:${recordId}:A`), button(`${currentType === "AAAA" ? "✅" : ""} AAAA · IPv6`, `edit:type:${recordId}:AAAA`)],
    [button(`${currentType === "CNAME" ? "✅" : ""} CNAME · 别名`, `edit:type:${recordId}:CNAME`)],
    [button("↩️ 返回记录详情", `edit:${recordId}`)],
  ] };
}

function editNameKeyboard(recordId: string, type: RecordType, currentName: string, domain: string): TelegramReplyMarkup {
  const root = currentName === domain ? "✅ 根域名" : "根域名";
  const wildcard = currentName === `*.${domain}` ? "✅ 泛域名 *" : "泛域名 *";
  return { inline_keyboard: [
    [button(root, `edit:name:${recordId}:${type}:root`), button(wildcard, `edit:name:${recordId}:${type}:wildcard`)],
    [button("↩️ 返回类型选择", `edit-options:${recordId}`)],
  ] };
}

function cancelKeyboard(): TelegramReplyMarkup {
  return { inline_keyboard: [[button("✖️ 取消输入", "cancel")]] };
}

function detailKeyboard(recordId: string): TelegramReplyMarkup {
  return { inline_keyboard: [
    [button("✏️ 修改内容", `edit-content:${recordId}`)],
    [button("🧩 完整编辑", `edit-options:${recordId}`)],
    [button("🗑️ 删除记录", `delete:${recordId}`), button("↩️ 返回列表", "list:0")],
  ] };
}

function resultKeyboard(): TelegramReplyMarkup {
  return { inline_keyboard: [[button("📋 查看记录", "menu:list"), button("↩️ 主菜单", "menu:home")]] };
}

function parseCommand(text: string) {
  const parts = text.trim().split(/\s+/).filter(Boolean);
  const command = parts.shift()?.replace(/^\//, "").split("@", 1)[0].toLowerCase();
  if (command === "dns") return parts;
  return [command || "help", ...parts];
}

function recordType(value: string): RecordType | undefined {
  const type = value.toUpperCase();
  return type === "A" || type === "AAAA" || type === "CNAME" ? type : undefined;
}

async function loadRecords(target: { domain: string; zoneId: string }, env: Env, settings: Settings) {
  return filteredRecords(await listDnsRecords(target, env, settings.cfApiToken), target.domain);
}

async function findRecord(target: { domain: string; zoneId: string }, env: Env, settings: Settings, id: string) {
  return (await loadRecords(target, env, settings)).find((record) => record.id === id);
}

async function showHome(settings: Settings, chatId: number) {
  await sendText(settings, chatId, homeText(settings), homeKeyboard());
}

async function showList(settings: Settings, env: Env, chatId: number, page: number, callback?: TelegramCallbackQuery) {
  const target = targetFromSettings(settings);
  const allRecords = await loadRecords(target, env, settings);
  const totalPages = Math.max(1, Math.ceil(allRecords.length / RECORDS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const records = allRecords.slice(safePage * RECORDS_PER_PAGE, (safePage + 1) * RECORDS_PER_PAGE);
  const text = recordListText(records, safePage, totalPages, target.domain);
  const markup = recordListKeyboard(records, safePage, totalPages);
  if (callback) await editText(settings, callback, text, markup);
  else await sendText(settings, chatId, text, markup);
}

async function showRecordDetail(settings: Settings, env: Env, callback: TelegramCallbackQuery, id: string) {
  const target = targetFromSettings(settings);
  const record = await findRecord(target, env, settings, id);
  if (!record) throw new HttpError(404, "记录不存在或已被删除");
  await editText(settings, callback, `DNS 记录详情\n\n${recordText(record)}\n\nID：${record.id}`, detailKeyboard(record.id));
}

async function handleCallback(settings: Settings, env: Env, callback: TelegramCallbackQuery) {
  const data = callback.data || "menu:home";
  const chatId = callback.message?.chat?.id ?? callback.from.id;
  await answerCallback(settings, callback);

  if (data === "menu:home") {
    await clearPending(env, chatId, callback.from.id);
    return editText(settings, callback, homeText(settings), homeKeyboard());
  }
  if (data === "menu:help") return editText(settings, callback, helpText(), backKeyboard());
  if (data === "menu:list") return showList(settings, env, chatId, 0, callback);
  if (data.startsWith("list:")) return showList(settings, env, chatId, Number(data.slice(5)) || 0, callback);
  if (data === "menu:add") {
    await clearPending(env, chatId, callback.from.id);
    return editText(settings, callback, "新增 DNS 记录\n\n请选择记录类型：", typeKeyboard());
  }
  if (data === "cancel") {
    await clearPending(env, chatId, callback.from.id);
    return editText(settings, callback, homeText(settings), homeKeyboard());
  }
  if (data.startsWith("add:type:")) {
    const type = recordType(data.slice(9));
    if (!type) throw new HttpError(400, "不支持的 DNS 记录类型");
    return editText(settings, callback, `新增 ${type} 记录\n\n请选择记录名称：`, nameKeyboard(type));
  }
  if (data.startsWith("add:name:")) {
    const parts = data.split(":");
    const type = recordType(parts[2] || "");
    if (!type || (parts[3] !== "root" && parts[3] !== "wildcard")) throw new HttpError(400, "无效的新增操作");
    const target = targetFromSettings(settings);
    const name = parts[3] === "root" ? target.domain : `*.${target.domain}`;
    await setPending(env, chatId, callback.from.id, { kind: "add", type, name });
    await sendText(settings, chatId, `新增 ${type} · ${name}\n\n请发送记录内容：\n${type === "A" ? "例如：1.1.1.1" : type === "AAAA" ? "例如：2606:4700:4700::1111" : "例如：target.example.net"}`, cancelKeyboard());
    return;
  }
  if (data.startsWith("edit-options:")) {
    const target = targetFromSettings(settings);
    const record = await findRecord(target, env, settings, data.slice(13));
    if (!record) throw new HttpError(404, "记录不存在或已被删除");
    const type = recordType(record.type);
    if (!type) throw new HttpError(400, "不支持编辑此记录类型");
    return editText(settings, callback, `完整编辑\n\n当前：${record.type} ${record.name}\n${record.content}\n\n请选择新的记录类型：`, editTypeKeyboard(record.id, type));
  }
  if (data.startsWith("edit:type:")) {
    const parts = data.split(":");
    const recordId = parts[2] || "";
    const type = recordType(parts[3] || "");
    if (!type) throw new HttpError(400, "不支持的 DNS 记录类型");
    const target = targetFromSettings(settings);
    const record = await findRecord(target, env, settings, recordId);
    if (!record) throw new HttpError(404, "记录不存在或已被删除");
    return editText(settings, callback, `完整编辑\n\n新类型：${type}\n\n请选择记录名称：`, editNameKeyboard(record.id, type, record.name, target.domain));
  }
  if (data.startsWith("edit:name:")) {
    const parts = data.split(":");
    const recordId = parts[2] || "";
    const type = recordType(parts[3] || "");
    const nameKind = parts[4];
    if (!type || (nameKind !== "root" && nameKind !== "wildcard")) throw new HttpError(400, "无效的编辑操作");
    const target = targetFromSettings(settings);
    const record = await findRecord(target, env, settings, recordId);
    if (!record) throw new HttpError(404, "记录不存在或已被删除");
    const name = nameKind === "root" ? target.domain : `*.${target.domain}`;
    await setPending(env, chatId, callback.from.id, { kind: "edit", type, name, recordId });
    await sendText(settings, chatId, `完整编辑 · ${type} ${name}\n\n当前内容：${record.content}\n\n请发送新的记录内容：`, cancelKeyboard());
    return;
  }
  if (data.startsWith("edit-content:")) {
    const target = targetFromSettings(settings);
    const record = await findRecord(target, env, settings, data.slice(13));
    if (!record) throw new HttpError(404, "记录不存在或已被删除");
    const type = recordType(record.type);
    if (!type) throw new HttpError(400, "不支持编辑此记录类型");
    const chat = callback.message?.chat?.id ?? callback.from.id;
    await setPending(env, chat, callback.from.id, { kind: "edit", type, name: record.name, recordId: record.id });
    await sendText(settings, chat, `修改 ${type} · ${record.name}\n\n当前内容：${record.content}\n\n请发送新的记录内容：`, cancelKeyboard());
    return;
  }
  if (data.startsWith("edit:")) return showRecordDetail(settings, env, callback, data.slice(5));
  if (data.startsWith("delete:")) {
    const id = data.slice(7);
    const target = targetFromSettings(settings);
    const record = await findRecord(target, env, settings, id);
    if (!record) throw new HttpError(404, "记录不存在或已被删除");
    return editText(settings, callback, `确认删除以下记录？\n\n${recordText(record)}\n\nID：${record.id}`, {
      inline_keyboard: [[button("✅ 确认删除", `delete-confirm:${record.id}`), button("取消", `edit:${record.id}`)]],
    });
  }
  if (data.startsWith("delete-confirm:")) {
    const id = data.slice(15);
    const target = targetFromSettings(settings);
    const record = await findRecord(target, env, settings, id);
    if (!record) throw new HttpError(404, "记录不存在或已被删除");
    await deleteDnsRecord(target, id, env, settings.cfApiToken);
    await clearPending(env, chatId, callback.from.id);
    return editText(settings, callback, `已删除 DNS 记录\n\n${record.type} ${record.name}\n${record.content}`, resultKeyboard());
  }
  throw new HttpError(400, "无效的按钮操作");
}

async function handlePendingMessage(settings: Settings, env: Env, message: TelegramMessage, pending: PendingInput) {
  const chatId = message.chat!.id;
  const content = message.text!.trim();
  if (!content) throw new HttpError(400, "记录内容不能为空");
  const target = targetFromSettings(settings);
  if (pending.kind === "add") {
    const record = await createDnsRecord(target, { type: pending.type, name: pending.name, content }, env, settings.cfApiToken);
    await clearPending(env, chatId, message.from!.id);
    return sendText(settings, chatId, `新增成功\n\n${recordText(record)}\n\nID：${record.id}`, resultKeyboard());
  }
  if (!pending.recordId) throw new HttpError(400, "编辑状态已失效，请重新选择记录");
  const record = await updateDnsRecord(target, pending.recordId, { type: pending.type, name: pending.name, content }, env, settings.cfApiToken);
  await clearPending(env, chatId, message.from!.id);
  return sendText(settings, chatId, `修改成功\n\n${recordText(record)}\n\nID：${record.id}`, resultKeyboard());
}

async function handleCommand(settings: Settings, env: Env, message: TelegramMessage) {
  const text = message.text!;
  const args = parseCommand(text);
  const command = args[0]?.toLowerCase() || "list";
  const chatId = message.chat!.id;
  if (command === "help" || command === "start" || command === "menu") {
    await clearPending(env, chatId, message.from!.id);
    return showHome(settings, chatId);
  }
  if (command === "cancel") {
    await clearPending(env, chatId, message.from!.id);
    return showHome(settings, chatId);
  }
  if (command === "list" || command === "ls" || command === "refresh") return showList(settings, env, chatId, 0);
  const target = targetFromSettings(settings);
  if (command === "add" && args.length >= 4) {
    const type = recordType(args[1]);
    if (!type) throw new HttpError(400, "仅支持 A、AAAA、CNAME");
    const record = await createDnsRecord(target, { type, name: args[2], content: args.slice(3).join(" ") }, env, settings.cfApiToken);
    return sendText(settings, chatId, `新增成功\n\n${recordText(record)}\n\nID：${record.id}`, resultKeyboard());
  }
  if (command === "update" && args.length >= 5) {
    const type = recordType(args[2]);
    if (!type) throw new HttpError(400, "仅支持 A、AAAA、CNAME");
    const record = await updateDnsRecord(target, args[1], { type, name: args[3], content: args.slice(4).join(" ") }, env, settings.cfApiToken);
    return sendText(settings, chatId, `修改成功\n\n${recordText(record)}\n\nID：${record.id}`, resultKeyboard());
  }
  if (command === "delete" && args.length === 2) {
    await deleteDnsRecord(target, args[1], env, settings.cfApiToken);
    return sendText(settings, chatId, `删除成功：${args[1]}`, resultKeyboard());
  }
  return sendText(settings, chatId, helpText(), backKeyboard());
}

export async function handleTelegramWebhook(request: Request, env: Env) {
  const settings = await getSettings(env);
  if (!settings.telegramBotToken || !settings.telegramWebhookSecret) return new Response("Not configured", { status: 404 });
  const secret = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (!secret || secret !== settings.telegramWebhookSecret) return new Response("Forbidden", { status: 403 });
  let update: TelegramUpdate;
  try { update = await request.json<TelegramUpdate>(); } catch { return new Response("Bad Request", { status: 400 }); }

  const callback = update.callback_query;
  const message = update.message;
  const userId = callback?.from.id ?? message?.from?.id;
  const chatId = callback?.message?.chat?.id ?? message?.chat?.id;
  if (userId == null || chatId == null) return new Response("ok");
  if (!allowed(settings, userId)) {
    if (callback) await answerCallback(settings, callback, "你没有权限操作此 Bot").catch(() => undefined);
    return new Response("ok");
  }

  try {
    if (callback) await handleCallback(settings, env, callback);
    else if (message?.text && message.from && message.chat) {
      if (message.text.trim().startsWith("/")) {
        await handleCommand(settings, env, message);
      } else {
        const pending = await getPending(env, chatId, userId);
        if (pending) await handlePendingMessage(settings, env, message, pending);
        else await showHome(settings, chatId);
      }
    }
  } catch (error) {
    const errorText = error instanceof Error ? error.message : "操作失败";
    if (callback) await sendText(settings, chatId, `操作失败：${errorText}`, backKeyboard());
    else await sendText(settings, chatId, `操作失败：${errorText}`, backKeyboard());
  }
  return new Response("ok");
}

export async function setTelegramWebhook(settings: Settings, webhookUrl: string) {
  if (!settings.telegramWebhookSecret) throw new HttpError(400, "请先设置 Telegram Webhook Secret");
  await telegramApi(settings, "setWebhook", {
    url: webhookUrl,
    secret_token: settings.telegramWebhookSecret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
  return webhookUrl;
}

export async function deleteTelegramWebhook(settings: Settings) {
  await telegramApi(settings, "deleteWebhook", { drop_pending_updates: false });
}

export async function telegramBotInfo(settings: Settings) {
  return telegramApi<{ id: number; username?: string; first_name?: string }>(settings, "getMe", {});
}
