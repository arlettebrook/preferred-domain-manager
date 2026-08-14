import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const output = join(tmpdir(), "preferred-domain-manager", "telegram-update-check.cjs");
mkdirSync(dirname(output), { recursive: true });
execFileSync(process.execPath, [
  join("node_modules", "esbuild", "bin", "esbuild"),
  "src/services/telegram.ts",
  "--bundle",
  "--platform=node",
  "--format=cjs",
  `--outfile=${output}`,
], { stdio: "ignore" });

const require = createRequire(import.meta.url);
const { handleTelegramWebhook } = require(output);

const settings = {
  ipSources: [],
  manualIps: [],
  defaultDomain: "example.com",
  cfZoneId: "zone-id",
  cfApiToken: "cf-token",
  telegramBotToken: "bot-token",
  telegramAllowedUserIds: ["123"],
  telegramWebhookSecret: "webhook-secret",
  updatedAt: new Date().toISOString(),
};

const values = new Map([["settings", JSON.stringify(settings)]]);
const env = {
  PDM_KV: {
    get: async (key, type) => {
      const value = values.get(key);
      return type === "json" && typeof value === "string" ? JSON.parse(value) : value ?? null;
    },
    put: async (key, value) => { values.set(key, value); },
    delete: async (key) => { values.delete(key); },
  },
};

let records = [];
const telegramMessages = [];
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.hostname === "api.telegram.org") {
    telegramMessages.push(JSON.parse(String(init.body || "{}")));
    return Response.json({ ok: true, result: true });
  }
  if (url.hostname !== "api.cloudflare.com") throw new Error(`unexpected request: ${url}`);

  const method = init.method || "GET";
  if (method === "GET") return Response.json({ success: true, result: records });
  const body = JSON.parse(String(init.body || "{}"));
  if (method === "POST") {
    const record = { id: body.name.startsWith("*.") ? "bbbbbbbb" : "aaaaaaaa", ...body };
    records.push(record);
    return Response.json({ success: true, result: record });
  }
  if (method === "PUT") {
    const id = decodeURIComponent(url.pathname.split("/").at(-1));
    const updated = { ...records.find((record) => record.id === id), ...body, id };
    records = records.map((record) => record.id === id ? updated : record);
    return Response.json({ success: true, result: updated });
  }
  throw new Error(`unexpected Cloudflare method: ${method}`);
};

async function sendUpdate(text) {
  const request = new Request("https://worker.example/telegram/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Telegram-Bot-Api-Secret-Token": settings.telegramWebhookSecret,
    },
    body: JSON.stringify({ message: { text, from: { id: 123 }, chat: { id: 456 } } }),
  });
  const response = await handleTelegramWebhook(request, env);
  if (response.status !== 200 || await response.text() !== "ok") throw new Error("Telegram webhook did not succeed");
}

await sendUpdate("/update 1.1.1.1");
if (records.length !== 2) throw new Error("空 DNS 记录时 /update 未创建根域名和泛域名记录");
if (!records.every((record) => record.type === "A" && record.content === "1.1.1.1")) throw new Error("空记录快捷新增的类型或内容不正确");
if (records.map((record) => record.name).sort().join(",") !== "*.example.com,example.com") throw new Error("空记录快捷新增的名称不正确");
if (!telegramMessages.at(-1)?.text?.startsWith("新增成功")) throw new Error("空记录快捷新增未返回成功消息");

await sendUpdate("/update 2.2.2.2");
if (!records.every((record) => record.content === "2.2.2.2")) throw new Error("唯一记录快捷更新行为发生回归");
if (!telegramMessages.at(-1)?.text?.startsWith("修改成功")) throw new Error("唯一记录快捷更新未返回成功消息");

rmSync(output, { force: true });
