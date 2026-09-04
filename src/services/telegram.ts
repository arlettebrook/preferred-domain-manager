import { HttpError } from "../errors";
import { PREFERRED_IP_CACHE_KEY, SETTINGS_KEY } from "../config";
import { createDnsRecord, deleteDnsRecord, listDnsRecords, replaceDnsRecords, updateDnsRecord } from "./cloudflare-dns";
import { domainProfiles, effectiveApiToken, effectiveTarget, getSettings } from "./settings";
import { DnsRecord, DnsTarget, Env, Settings } from "../types";
import { dedupeIps, detectDnsRecordType } from "../validation";
import { deleteTelegramWebhook, setTelegramCommands, setTelegramWebhook, telegramApi, telegramBotInfo } from "../integrations/telegram/client";

const MAX_MESSAGE_LENGTH = 3900;
const RECORDS_PER_PAGE = 6;
const PENDING_TTL_SECONDS = 10 * 60;
const PENDING_PREFIX = "telegram:pending:";
const SELECTION_TTL_SECONDS = 10 * 60;
const SELECTION_PREFIX = "telegram:selection:";
const DOMAIN_SELECTION_PREFIX = "telegram:domain:";

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

interface TelegramButton {
  text: string;
  callback_data: string;
}

interface TelegramReplyMarkup {
  inline_keyboard?: TelegramButton[][];
  force_reply?: boolean;
  selective?: boolean;
}

type PendingInput =
  | { kind: "add"; type: RecordType; name?: string; recordId?: string; page?: number }
  | { kind: "edit"; type: RecordType; name?: string; recordId?: string; page?: number }
  | { kind: "bulk"; page?: number; confirmEmpty?: boolean }
  | { kind: "manual-ips"; page?: number };

interface RecordSelection {
  recordIds: string[];
  page: number;
}

function targetFromSettings(settings: Settings) {
  const target = effectiveTarget(settings);
  if (!target) throw new HttpError(400, "后台尚未配置默认域名和 Zone ID");
  return target;
}

function allowed(settings: Settings, userId: number) {
  return (settings.telegramAllowedUserIds ?? []).includes(String(userId));
}

async function sendText(settings: Settings, chatId: number, text: string, replyMarkup?: TelegramReplyMarkup) {
  for (let index = 0; index < text.length; index += MAX_MESSAGE_LENGTH) {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: text.slice(index, index + MAX_MESSAGE_LENGTH),
      parse_mode: "HTML",
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
    parse_mode: "HTML",
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

function selectionKey(chatId: number, userId: number) {
  return `${SELECTION_PREFIX}${chatId}:${userId}`;
}

function domainSelectionKey(chatId: number, userId: number) {
  return `${DOMAIN_SELECTION_PREFIX}${chatId}:${userId}`;
}

async function selectedDomainId(env: Env, chatId: number, userId: number) {
  return env.PDM_KV.get<string>(domainSelectionKey(chatId, userId));
}

async function saveDomainSelection(env: Env, chatId: number, userId: number, domainId: string) {
  await env.PDM_KV.put(domainSelectionKey(chatId, userId), domainId, { expirationTtl: SELECTION_TTL_SECONDS });
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

async function saveSelection(env: Env, chatId: number, userId: number, selection: RecordSelection) {
  await env.PDM_KV.put(selectionKey(chatId, userId), JSON.stringify(selection), { expirationTtl: SELECTION_TTL_SECONDS });
}

async function selectionPage(env: Env, chatId: number, userId: number) {
  return (await env.PDM_KV.get<RecordSelection>(selectionKey(chatId, userId), "json"))?.page ?? 0;
}

async function selectedRecord(target: { domain: string; zoneId: string }, env: Env, settings: Settings, chatId: number, userId: number, value: string) {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new HttpError(400, "请使用 DNS 列表中的序号，例如 /edit 2");
  const selection = await env.PDM_KV.get<RecordSelection>(selectionKey(chatId, userId), "json");
  const recordId = selection?.recordIds[Number(value) - 1];
  if (!recordId) throw new HttpError(400, "序号已过期，请先发送 /dns 刷新记录列表");
  const record = await findRecord(target, env, settings, recordId);
  if (!record) throw new HttpError(404, "记录不存在或已被删除，请重新发送 /dns");
  return record;
}

function button(text: string, callbackData: string): TelegramButton {
  return { text, callback_data: callbackData };
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character] ?? character));
}

function homeKeyboard(settings?: Settings): TelegramReplyMarkup {
  const rows: TelegramButton[][] = [
    [button("📋 DNS 记录", "menu:list"), button("➕ 添加记录", "menu:add")],
    [button("📝 批量编辑", "menu:bulk")],
    [button("⚙️ 手动优选 IP", "menu:manual")],
    [button("🔄 刷新", "menu:list"), button("❓ 帮助", "menu:help")],
  ];
  if (settings && domainProfiles(settings).length > 1) rows.splice(1, 0, [button("◎ 选择域名", "menu:domains")]);
  return { inline_keyboard: rows };
}

function domainKeyboard(settings: Settings): TelegramReplyMarkup {
  return { inline_keyboard: domainProfiles(settings).map((profile) => [button(`${profile.domain === settings.defaultDomain ? "✓ " : ""}${profile.domain}`, `domain:${profile.id}`)]).concat([[button("返回主菜单", "menu:home")]]) };
}

function backKeyboard(): TelegramReplyMarkup {
  return { inline_keyboard: [[button("↩️ 返回主菜单", "menu:home")]] };
}

function homeText(settings: Settings) {
  const target = settings.defaultDomain && settings.cfZoneId
    ? `当前域名：<code>${escapeHtml(settings.defaultDomain)}</code>`
    : "当前尚未完成默认域名和 Zone ID 配置";
  return [`优选域名管理 Bot`, target].join("\n");
}

function helpText() {
  return [
    "优选域名管理 Bot",
    "",
    "/start 或 /help  打开主菜单",
    "/dns  查看 DNS 记录",
    "/bulk  批量编辑当前域名 DNS（每行一个 IP 或目标域名）",
    "/manual  查看和编辑手动优选 IP 配置",
    "/add  新增 DNS 记录",
    "/dns add A 〈IPv4〉",
    "/dns add AAAA 〈IPv6〉",
    "/dns add CNAME 〈目标〉",
    "/edit [序号] 编辑记录；唯一记录时可省略序号",
    "/delete [序号] 删除记录；唯一记录时可省略序号",
    "/update 〈IP 或域名〉 无记录时新增，唯一记录时更新",
    "点击域名或记录内容可复制，点击序号可选择编辑或删除。",
    "",
    "仅操作默认域名；仅支持 A、AAAA、CNAME；保存后会自动同步对应泛记录。CNAME 会清理两侧同名 A/AAAA。",
  ].join("\n");
}

function filteredRecords(records: DnsRecord[], target: DnsTarget) {
  const names = target.syncWildcard === false ? [target.domain, `*.${target.domain}`] : [target.domain];
  return records.filter((record) => names.includes(record.name) && ["A", "AAAA", "CNAME"].includes(record.type));
}

function recordText(record: DnsRecord) {
  return `${escapeHtml(record.type)}   <code>${escapeHtml(record.name)}</code>   <code>${escapeHtml(record.content)}</code>`;
}

function recordListText(records: DnsRecord[], page: number, totalPages: number, totalCount: number, domain: string) {
  if (!records.length) return `DNS 记录\n\n<code>${escapeHtml(domain)}</code> 当前没有可管理记录。\n\n使用 /add 新增记录。`;
  return [
    `DNS 记录（第 ${page + 1}/${totalPages} 页，共 ${totalCount} 条）`,
    "点击域名或 IP/CNAME 内容可复制；点击序号选择操作。",
    "",
    records.map((record, index) => `${index + 1}. ${recordText(record)}`).join("\n\n"),
  ].join("\n");
}

function recordListKeyboard(records: DnsRecord[], page: number, totalPages: number, settings?: Settings): TelegramReplyMarkup {
  const rows: TelegramButton[][] = [];
  records.forEach((record, index) => {
    rows.push([button(String(index + 1), `record:${record.id}`)]);
  });
  const navigation: TelegramButton[] = [];
  if (page > 0) navigation.push(button("上一页", `list:${page - 1}`));
  if (page + 1 < totalPages) navigation.push(button("下一页", `list:${page + 1}`));
  if (navigation.length) rows.push(navigation);
  rows.push([button("📝 批量编辑", "menu:bulk")]);
  if (settings && domainProfiles(settings).length > 1) rows.push([button("◎ 选择域名", "menu:domains")]);
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

function editTypeKeyboard(recordId: string, currentType: RecordType): TelegramReplyMarkup {
  return { inline_keyboard: [
    [button(`${currentType === "A" ? "✅" : ""} A · IPv4`, `edit:type:${recordId}:A`), button(`${currentType === "AAAA" ? "✅" : ""} AAAA · IPv6`, `edit:type:${recordId}:AAAA`)],
    [button(`${currentType === "CNAME" ? "✅" : ""} CNAME · 别名`, `edit:type:${recordId}:CNAME`)],
    [button("↩️ 返回内容编辑", `edit:${recordId}`)],
  ] };
}

function cancelKeyboard(): TelegramReplyMarkup {
  return { inline_keyboard: [[button("✖️ 取消输入", "cancel")]] };
}

function editPromptKeyboard(recordId: string): TelegramReplyMarkup {
  return { inline_keyboard: [
    [button("完整编辑", `edit-options:${recordId}`)],
    [button("取消并返回列表", "cancel")],
  ] };
}

function resultKeyboard(page = 0): TelegramReplyMarkup {
  return { inline_keyboard: [[button("📋 查看记录", `list:${page}`), button("↩️ 主菜单", "menu:home")]] };
}

function bulkEditKeyboard(): TelegramReplyMarkup {
  return { inline_keyboard: [
    [button("一键同步", "bulk:sync"), button("反向同步", "bulk:reverse")],
    [button("✖️ 取消输入", "cancel")],
  ] };
}

function manualIpsText(settings: Settings) {
  const ips = dedupeIps(settings.manualIps ?? []);
  return [
    "手动优选 IP 配置",
    `当前配置：${ips.length} 个`,
    "",
    ips.length ? `<pre>${escapeHtml(ips.join("\n"))}</pre>` : "（尚未配置手动优选 IP）",
  ].join("\n");
}

function manualIpsKeyboard(): TelegramReplyMarkup {
  return { inline_keyboard: [
    [button("编辑配置", "manual:edit"), button("一键同步到 DNS", "manual:sync")],
    [button("清空配置", "manual:clear")],
    [button("↩️ 返回主菜单", "menu:home")],
  ] };
}

function manualIpsClearKeyboard(): TelegramReplyMarkup {
  return { inline_keyboard: [[button("✅ 确认清空", "manual:clear-confirm"), button("取消", "menu:manual")]] };
}

function bulkEmptyConfirmKeyboard(): TelegramReplyMarkup {
  return { inline_keyboard: [[button("✅ 确认清空", "bulk:confirm-empty"), button("取消", "cancel")]] };
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

async function loadRecords(target: DnsTarget, env: Env, settings: Settings) {
  return filteredRecords(await listDnsRecords(target, env, settings.cfApiToken), target);
}

async function findRecord(target: DnsTarget, env: Env, settings: Settings, id: string) {
  return (await loadRecords(target, env, settings)).find((record) => record.id === id);
}

async function showHome(settings: Settings, chatId: number) {
  await sendText(settings, chatId, homeText(settings), homeKeyboard(settings));
}

async function showManualIps(settings: Settings, chatId: number, callback?: TelegramCallbackQuery) {
  const text = manualIpsText(settings);
  const markup = manualIpsKeyboard();
  if (callback) await editText(settings, callback, text, markup);
  else await sendText(settings, chatId, text, markup);
}

async function startBulkEdit(
  settings: Settings,
  env: Env,
  chatId: number,
  userId: number,
  callback?: TelegramCallbackQuery,
) {
  const target = targetFromSettings(settings);
  const records = await loadRecords(target, env, settings);
  const values = records.map((record) => record.content.trim()).filter(Boolean);
  await setPending(env, chatId, userId, { kind: "bulk", page: await selectionPage(env, chatId, userId) });
  const current = values.length
    ? `<pre>${escapeHtml(values.join("\n"))}</pre>`
    : "（当前没有可编辑记录）";
  const text = [
    "批量编辑 DNS",
    `<code>${escapeHtml(target.domain)}</code> 当前有 ${values.length} 条可编辑记录。`,
    "",
    "请发送新的内容，每行一个 IP 或目标域名。保存时会自动识别 A、AAAA 或 CNAME；空行和 # 开头的行会忽略。",
    "",
    "当前记录：",
    current,
  ].join("\n");
  const markup = bulkEditKeyboard();
  if (callback) await editText(settings, callback, text, markup);
  else await sendText(settings, chatId, text, markup);
}

async function saveManualIps(env: Env, ips: string[]) {
  const current = await getSettings(env);
  const manualIps = dedupeIps(ips);
  const updated = { ...current, manualIps, updatedAt: new Date().toISOString() };
  await env.PDM_KV.put(SETTINGS_KEY, JSON.stringify(updated));
  await env.PDM_KV.delete(PREFERRED_IP_CACHE_KEY);
  return manualIps;
}

async function syncBulkFromManual(settings: Settings, env: Env, callback: TelegramCallbackQuery, chatId: number) {
  const target = targetFromSettings(settings);
  const manualIps = dedupeIps(settings.manualIps ?? []);
  if (!manualIps.length) throw new HttpError(400, "尚未配置手动优选 IP");
  const result = await replaceDnsRecords(target, manualIps.map((content) => ({ name: target.domain, content })), env, settings.cfApiToken);
  const pending = await getPending(env, chatId, callback.from.id);
  await clearPending(env, chatId, callback.from.id);
  return editText(settings, callback, `一键同步完成\n\n新增：${result.created} 条\n更新：${result.updated} 条\n删除：${result.deleted} 条\n当前共：${result.total} 条`, resultKeyboard(pending?.page ?? 0));
}

async function syncBulkToManual(settings: Settings, env: Env, callback: TelegramCallbackQuery, chatId: number) {
  const target = targetFromSettings(settings);
  const records = await loadRecords(target, env, settings);
  const manualIps = dedupeIps(records.filter((record) => record.type === "A" || record.type === "AAAA").map((record) => record.content));
  if (!manualIps.length) throw new HttpError(400, "当前 DNS 记录中没有可同步的 IPv4 或 IPv6");
  await saveManualIps(env, manualIps);
  const pending = await getPending(env, chatId, callback.from.id);
  await clearPending(env, chatId, callback.from.id);
  return editText(settings, callback, `反向同步完成\n\n已保存：${manualIps.length} 个手动优选 IP`, resultKeyboard(pending?.page ?? 0));
}

async function showList(settings: Settings, env: Env, chatId: number, userId: number, page: number, callback?: TelegramCallbackQuery) {
  const target = targetFromSettings(settings);
  const allRecords = await loadRecords(target, env, settings);
  const totalPages = Math.max(1, Math.ceil(allRecords.length / RECORDS_PER_PAGE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const records = allRecords.slice(safePage * RECORDS_PER_PAGE, (safePage + 1) * RECORDS_PER_PAGE);
  await saveSelection(env, chatId, userId, { recordIds: records.map((record) => record.id), page: safePage });
  const text = recordListText(records, safePage, totalPages, allRecords.length, target.domain);
  const markup = recordListKeyboard(records, safePage, totalPages, settings);
  if (callback) await editText(settings, callback, text, markup);
  else await sendText(settings, chatId, text, markup);
}

function recordActionKeyboard(record: DnsRecord, page: number): TelegramReplyMarkup {
  return { inline_keyboard: [
    [button("编辑内容", `edit:${record.id}`), button("删除记录", `delete:${record.id}`)],
    [button("返回列表", `list:${page}`)],
  ] };
}

async function showRecordActions(settings: Settings, env: Env, callback: TelegramCallbackQuery, id: string) {
  const target = targetFromSettings(settings);
  const chatId = callback.message?.chat?.id ?? callback.from.id;
  const record = await findRecord(target, env, settings, id);
  if (!record) throw new HttpError(404, "记录不存在或已被删除");
  const page = await selectionPage(env, chatId, callback.from.id);
  return editText(settings, callback, `DNS 记录\n${recordText(record)}\n\n请选择操作：`, recordActionKeyboard(record, page));
}

async function startContentEdit(
  settings: Settings,
  env: Env,
  chatId: number,
  userId: number,
  record: DnsRecord,
  page: number,
  callback?: TelegramCallbackQuery,
) {
  const type = recordType(record.type);
  if (!type) throw new HttpError(400, "不支持编辑此记录类型");
  await setPending(env, chatId, userId, {
    kind: "edit",
    type,
    name: record.name,
    recordId: record.id,
    page,
  });
  const text = `编辑 DNS 记录\n${recordText(record)}\n\n请发送新的 IP 或 CNAME 目标。`;
  const markup = editPromptKeyboard(record.id);
  if (callback) await editText(settings, callback, text, markup);
  else await sendText(settings, chatId, text, markup);
}

async function showDeletePrompt(
  settings: Settings,
  chatId: number,
  record: DnsRecord,
  page: number,
  callback?: TelegramCallbackQuery,
) {
  const markup = {
    inline_keyboard: [[
      button("✅ 确认删除", `delete-confirm:${record.id}`),
      button("取消", `list:${page}`),
    ]],
  } satisfies TelegramReplyMarkup;
  const text = `确认删除 DNS 记录？\n\n${recordText(record)}`;
  if (callback) await editText(settings, callback, text, markup);
  else await sendText(settings, chatId, text, markup);
}

async function handleCallback(settings: Settings, env: Env, callback: TelegramCallbackQuery) {
  const data = callback.data || "menu:home";
  const chatId = callback.message?.chat?.id ?? callback.from.id;
  await answerCallback(settings, callback);

  if (data === "menu:home") {
    await clearPending(env, chatId, callback.from.id);
    return editText(settings, callback, homeText(settings), homeKeyboard(settings));
  }
  if (data === "menu:domains") return editText(settings, callback, "请选择要编辑的域名", domainKeyboard(settings));
  if (data.startsWith("domain:")) {
    const domainId = data.slice(7);
    const target = effectiveTarget(settings, domainId);
    if (!target) throw new HttpError(404, "指定的域名不存在");
    await saveDomainSelection(env, chatId, callback.from.id, domainId);
    await clearPending(env, chatId, callback.from.id);
    await env.PDM_KV.delete(selectionKey(chatId, callback.from.id));
    const scopedSettings = {
      ...settings,
      defaultDomain: target.domain,
      cfZoneId: target.zoneId,
      cfApiToken: effectiveApiToken(settings, domainId),
    };
    return showList(scopedSettings, env, chatId, callback.from.id, 0, callback);
  }
  if (data === "menu:help") return editText(settings, callback, helpText(), backKeyboard());
  if (data === "menu:list") return showList(settings, env, chatId, callback.from.id, 0, callback);
  if (data.startsWith("list:")) return showList(settings, env, chatId, callback.from.id, Number(data.slice(5)) || 0, callback);
  if (data === "menu:manual") return showManualIps(settings, chatId, callback);
  if (data === "manual:edit") {
    await setPending(env, chatId, callback.from.id, { kind: "manual-ips" });
    return editText(settings, callback, "编辑手动优选 IP 配置\n\n请发送新的 IPv4 或 IPv6 列表，可每行一个，也可用空格或逗号分隔。无效地址会被忽略，重复地址会自动去重。", cancelKeyboard());
  }
  if (data === "manual:sync") return syncBulkFromManual(settings, env, callback, chatId);
  if (data === "manual:clear") {
    const count = dedupeIps(settings.manualIps ?? []).length;
    if (!count) return showManualIps(settings, chatId, callback);
    return editText(settings, callback, `确定清空当前 ${count} 个手动优选 IP 吗？\n\n清空配置不会自动修改现有 DNS 记录。`, manualIpsClearKeyboard());
  }
  if (data === "manual:clear-confirm") {
    await saveManualIps(env, []);
    return showManualIps({ ...settings, manualIps: [] }, chatId, callback);
  }
  if (data === "menu:add") {
    await clearPending(env, chatId, callback.from.id);
    return editText(settings, callback, "新增 DNS 记录\n\n请选择记录类型：", typeKeyboard());
  }
  if (data === "menu:bulk") return startBulkEdit(settings, env, chatId, callback.from.id, callback);
  if (data === "bulk:sync") return syncBulkFromManual(settings, env, callback, chatId);
  if (data === "bulk:reverse") return syncBulkToManual(settings, env, callback, chatId);
  if (data === "bulk:confirm-empty") {
    const pending = await getPending(env, chatId, callback.from.id);
    if (!pending || pending.kind !== "bulk" || !pending.confirmEmpty) throw new HttpError(400, "批量编辑状态已失效，请重新打开批量编辑");
    const target = targetFromSettings(settings);
    const result = await replaceDnsRecords(target, [], env, settings.cfApiToken);
    await clearPending(env, chatId, callback.from.id);
    return editText(settings, callback, `批量清空完成\n\n删除：${result.deleted} 条\n当前共：${result.total} 条`, resultKeyboard(pending.page ?? 0));
  }
  if (data === "cancel") {
    const pending = await getPending(env, chatId, callback.from.id);
    await clearPending(env, chatId, callback.from.id);
    if (pending?.kind === "manual-ips") return showManualIps(settings, chatId, callback);
    if (pending?.page != null) return showList(settings, env, chatId, callback.from.id, pending.page, callback);
    return editText(settings, callback, homeText(settings), homeKeyboard(settings));
  }
  if (data.startsWith("add:type:")) {
    const type = recordType(data.slice(9));
    if (!type) throw new HttpError(400, "不支持的 DNS 记录类型");
    const target = targetFromSettings(settings);
    const name = target.domain;
    await setPending(env, chatId, callback.from.id, { kind: "add", type, name });
    return editText(settings, callback, `新增 ${type} · <code>${escapeHtml(name)}</code>\n\n请发送记录内容：\n${type === "A" ? "例如：1.1.1.1" : type === "AAAA" ? "例如：2606:4700:4700::1111" : "例如：target.example.net"}`, cancelKeyboard());
  }
  if (data.startsWith("record:")) return showRecordActions(settings, env, callback, data.slice(7));
  if (data.startsWith("edit-options:")) {
    const target = targetFromSettings(settings);
    const record = await findRecord(target, env, settings, data.slice(13));
    if (!record) throw new HttpError(404, "记录不存在或已被删除");
    await clearPending(env, chatId, callback.from.id);
    const type = recordType(record.type);
    if (!type) throw new HttpError(400, "不支持编辑此记录类型");
    return editText(settings, callback, `完整编辑\n\n当前：<code>${escapeHtml(record.type)} ${escapeHtml(record.name)}</code>\n<code>${escapeHtml(record.content)}</code>\n\n请选择新的记录类型：`, editTypeKeyboard(record.id, type));
  }
  if (data.startsWith("edit:type:")) {
    const parts = data.split(":");
    const recordId = parts[2] || "";
    const type = recordType(parts[3] || "");
    if (!type) throw new HttpError(400, "不支持的 DNS 记录类型");
    const target = targetFromSettings(settings);
    const record = await findRecord(target, env, settings, recordId);
    if (!record) throw new HttpError(404, "记录不存在或已被删除");
    await setPending(env, chatId, callback.from.id, { kind: "edit", type, name: record.name, recordId, page: await selectionPage(env, chatId, callback.from.id) });
    return editText(settings, callback, `完整编辑 · ${type} <code>${escapeHtml(target.domain)}</code>\n\n当前内容：<code>${escapeHtml(record.content)}</code>\n\n请发送新的记录内容：`, cancelKeyboard());
  }
  if (data.startsWith("edit-content:")) {
    const target = targetFromSettings(settings);
    const record = await findRecord(target, env, settings, data.slice(13));
    if (!record) throw new HttpError(404, "记录不存在或已被删除");
    const type = recordType(record.type);
    if (!type) throw new HttpError(400, "不支持编辑此记录类型");
    const chat = callback.message?.chat?.id ?? callback.from.id;
    await setPending(env, chat, callback.from.id, { kind: "edit", type, name: record.name, recordId: record.id, page: await selectionPage(env, chat, callback.from.id) });
    await sendText(settings, chat, `修改 ${type} · <code>${escapeHtml(record.name)}</code>\n\n当前内容：<code>${escapeHtml(record.content)}</code>\n\n请发送新的记录内容：`, cancelKeyboard());
    return;
  }
  if (data.startsWith("edit:")) {
    const target = targetFromSettings(settings);
    const record = await findRecord(target, env, settings, data.slice(5));
    if (!record) throw new HttpError(404, "记录不存在或已被删除");
    return startContentEdit(settings, env, chatId, callback.from.id, record, await selectionPage(env, chatId, callback.from.id), callback);
  }
  if (data.startsWith("delete:")) {
    const id = data.slice(7);
    const target = targetFromSettings(settings);
    const record = await findRecord(target, env, settings, id);
    if (!record) throw new HttpError(404, "记录不存在或已被删除");
    return showDeletePrompt(settings, chatId, record, await selectionPage(env, chatId, callback.from.id), callback);
  }
  if (data.startsWith("delete-confirm:")) {
    const id = data.slice(15);
    const target = targetFromSettings(settings);
    const record = await findRecord(target, env, settings, id);
    if (!record) throw new HttpError(404, "记录不存在或已被删除");
    await deleteDnsRecord(target, id, env, settings.cfApiToken);
    await clearPending(env, chatId, callback.from.id);
    return editText(settings, callback, `已删除\n${recordText(record)}`, resultKeyboard(await selectionPage(env, chatId, callback.from.id)));
  }
  throw new HttpError(400, "无效的按钮操作");
}

async function handlePendingMessage(settings: Settings, env: Env, message: TelegramMessage, pending: PendingInput) {
  const chatId = message.chat!.id;
  const content = message.text!.trim();
  if (pending.kind === "manual-ips") {
    const manualIps = dedupeIps(content.split(/[\s,]+/));
    if (!manualIps.length) throw new HttpError(400, "未检测到有效的 IPv4 或 IPv6 地址，请重新发送");
    await saveManualIps(env, manualIps);
    await clearPending(env, chatId, message.from!.id);
    return sendText(settings, chatId, `手动优选 IP 配置已保存\n\n当前配置：${manualIps.length} 个\n\n<pre>${escapeHtml(manualIps.join("\n"))}</pre>`, manualIpsKeyboard());
  }
  const target = targetFromSettings(settings);
  if (pending.kind === "bulk") {
    const lines = content.split(/\r?\n/);
    const values = lines.map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
    if (!values.length) {
      await setPending(env, chatId, message.from!.id, { kind: "bulk", page: pending.page, confirmEmpty: true });
      return sendText(settings, chatId, "批量内容为空，将删除当前域名全部可编辑 DNS 记录。确定继续吗？", bulkEmptyConfirmKeyboard());
    }
    const records = values.map((value) => ({ name: target.domain, content: value }));
    const result = await replaceDnsRecords(target, records, env, settings.cfApiToken);
    await clearPending(env, chatId, message.from!.id);
    return sendText(
      settings,
      chatId,
      `批量保存完成\n\n新增：${result.created} 条\n更新：${result.updated} 条\n删除：${result.deleted} 条\n当前共：${result.total} 条`,
      resultKeyboard(pending.page ?? 0),
    );
  }
  if (!content) throw new HttpError(400, "记录内容不能为空");
  if (pending.kind === "add") {
    const record = await createDnsRecord(target, { type: pending.type, name: pending.name, content }, env, settings.cfApiToken);
    await clearPending(env, chatId, message.from!.id);
    return sendText(settings, chatId, `新增成功\n\n${recordText(record)}`, resultKeyboard(pending.page ?? 0));
  }
  if (!pending.recordId) throw new HttpError(400, "编辑状态已失效，请重新选择记录");
  const record = await updateDnsRecord(target, pending.recordId, { type: detectDnsRecordType(content), name: pending.name, content }, env, settings.cfApiToken);
  await clearPending(env, chatId, message.from!.id);
  return sendText(settings, chatId, `修改成功\n\n${recordText(record)}`, resultKeyboard(pending.page ?? 0));
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
    const pending = await getPending(env, chatId, message.from!.id);
    await clearPending(env, chatId, message.from!.id);
    if (pending?.page != null) return showList(settings, env, chatId, message.from!.id, pending.page);
    return showHome(settings, chatId);
  }
  if (command === "list" || command === "ls" || command === "refresh") return showList(settings, env, chatId, message.from!.id, 0);
  if (command === "bulk" || command === "batch") return startBulkEdit(settings, env, chatId, message.from!.id);
  if (command === "manual" || command === "ips") return showManualIps(settings, chatId);
  if (command === "add" && args.length === 1) return sendText(settings, chatId, "新增 DNS 记录\n\n请选择记录类型：", typeKeyboard());
  if (command === "add" && args.length > 1 && args.length < 3) return sendText(settings, chatId, "格式：/add A 〈IPv4〉，或直接点击新增菜单。", backKeyboard());
  if (command === "edit" && args.length > 2) return sendText(settings, chatId, "格式：/edit 〈序号〉，请先发送 /dns 获取最新序号。", backKeyboard());
  if (command === "delete" && args.length > 2) return sendText(settings, chatId, "格式：/delete 〈序号〉，请先发送 /dns 获取最新序号。", backKeyboard());
  const target = targetFromSettings(settings);
  if (command === "edit" && args.length === 1) {
    const records = await loadRecords(target, env, settings);
    if (records.length === 1) return startContentEdit(settings, env, chatId, message.from!.id, records[0], 0);
    return showList(settings, env, chatId, message.from!.id, 0);
  }
  if (command === "delete" && args.length === 1) {
    const records = await loadRecords(target, env, settings);
    if (records.length === 1) return showDeletePrompt(settings, chatId, records[0], 0);
    return showList(settings, env, chatId, message.from!.id, 0);
  }
  if (command === "add" && args.length >= 3) {
    const type = recordType(args[1]);
    if (!type) throw new HttpError(400, "仅支持 A、AAAA、CNAME");
    const suppliedName = args.length >= 4 ? args[2].toLowerCase() : "";
    const wildcard = `*.${target.domain}`;
    const hasExplicitName = suppliedName === target.domain || (target.syncWildcard === false && suppliedName === wildcard);
    if (args.length >= 4 && !hasExplicitName) throw new HttpError(400, `记录名称只能是 ${target.domain}${target.syncWildcard === false ? ` 或 ${wildcard}` : ""}`);
    const name = hasExplicitName ? suppliedName : target.domain;
    const record = await createDnsRecord(target, { type, name, content: args.slice(hasExplicitName ? 3 : 2).join(" ") }, env, settings.cfApiToken);
    return sendText(settings, chatId, `新增成功\n\n${recordText(record)}`, resultKeyboard());
  }
  if (command === "update" && args.length >= 4) {
    const hasLegacyName = args.length >= 5 && args[3].toLowerCase() === target.domain;
    const content = args.slice(hasLegacyName ? 4 : 3).join(" ");
    const record = await updateDnsRecord(target, args[1], { type: detectDnsRecordType(content), name: hasLegacyName ? args[3] : target.domain, content }, env, settings.cfApiToken);
    return sendText(settings, chatId, `修改成功\n\n${recordText(record)}`, resultKeyboard());
  }
  if (command === "update" && args.length === 2) {
    const records = await loadRecords(target, env, settings);
    const content = args[1];
    if (!records.length) {
      const created = await createDnsRecord(target, {
        type: detectDnsRecordType(content),
        name: target.domain,
        content,
      }, env, settings.cfApiToken);
      return sendText(settings, chatId, `新增成功\n\n${recordText(created)}`, resultKeyboard());
    }
    if (records.length > 1) {
      return sendText(settings, chatId, "当前不是唯一记录，无法使用快捷更新。请使用 /dns 后点击序号，或使用 /edit 序号。", backKeyboard());
    }
    const record = records[0];
    const updated = await updateDnsRecord(target, record.id, {
      type: detectDnsRecordType(content),
      name: record.name,
      content,
    }, env, settings.cfApiToken);
    return sendText(settings, chatId, `修改成功\n\n${recordText(updated)}`, resultKeyboard());
  }
  if (command === "update") return sendText(settings, chatId, "格式：/update <IP 或域名>（无记录时新增，唯一记录时更新）", backKeyboard());
  if (command === "edit" && args.length === 2) {
    const record = await selectedRecord(target, env, settings, chatId, message.from!.id, args[1]);
    return startContentEdit(settings, env, chatId, message.from!.id, record, await selectionPage(env, chatId, message.from!.id));
  }
  if (command === "delete" && args.length === 2 && /^\d+$/.test(args[1])) {
    const record = await selectedRecord(target, env, settings, chatId, message.from!.id, args[1]);
    return showDeletePrompt(settings, chatId, record, await selectionPage(env, chatId, message.from!.id));
  }
  if (command === "delete" && args.length === 2) {
    await deleteDnsRecord(target, args[1], env, settings.cfApiToken);
    return sendText(settings, chatId, `删除成功：<code>${escapeHtml(args[1])}</code>`, resultKeyboard());
  }
  return sendText(settings, chatId, helpText(), backKeyboard());
}

export async function handleTelegramWebhook(request: Request, env: Env) {
  let settings = await getSettings(env);
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

  const selectedId = (await selectedDomainId(env, chatId, userId)) || undefined;
  const selectedTarget = selectedId ? effectiveTarget(settings, selectedId) : undefined;
  const selectedToken = effectiveApiToken(settings, selectedId);
  if (selectedTarget) settings = { ...settings, defaultDomain: selectedTarget.domain, cfZoneId: selectedTarget.zoneId, cfApiToken: selectedToken };
  else settings = { ...settings, cfApiToken: effectiveApiToken(settings) };

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
    await sendText(settings, chatId, `操作失败：${escapeHtml(errorText)}`, backKeyboard());
  }
  return new Response("ok");
}
