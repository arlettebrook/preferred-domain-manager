import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "telegram-subdomains-"));
const originalFetch = globalThis.fetch;
try {
  const output = join(directory, "telegram.cjs");
  execFileSync(process.execPath, [join("node_modules", "esbuild", "bin", "esbuild"), "src/services/telegram.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${output}`], { stdio: "ignore" });
  const { handleTelegramWebhook } = createRequire(import.meta.url)(output);
  const profiles = [
    { id: "primary", domain: "example.com", zoneId: "zone-1", apiToken: "token-1", syncWildcard: false },
    { id: "secondary", domain: "other.example.net", zoneId: "zone-2", apiToken: "token-2", syncWildcard: true },
  ];
  const settings = { ipSources: [], manualIps: [], domains: profiles, defaultDomain: profiles[0].domain, cfZoneId: profiles[0].zoneId, telegramBotToken: "test-bot", telegramAllowedUserIds: ["123"], telegramWebhookSecret: "test-secret" };
  const values = new Map([["settings", JSON.stringify(settings)]]);
  const env = { PDM_KV: {
    get: async (key, type) => { const value = values.get(key); return type === "json" && value ? JSON.parse(value) : value ?? null; },
    put: async (key, value) => values.set(key, value),
    delete: async (key) => values.delete(key),
  } };
  let sequence = 0;
  const zones = new Map(profiles.map((profile) => [profile.zoneId, []]));
  const messages = [];
  const dnsRequests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (url.hostname === "api.telegram.org") {
      messages.push({ method: url.pathname.split("/").at(-1), ...body });
      return Response.json({ ok: true, result: true });
    }
    assert.equal(url.hostname, "api.cloudflare.com");
    const zoneId = url.pathname.split("/")[4];
    const profile = profiles.find((item) => item.zoneId === zoneId);
    assert.equal(init.headers.authorization, `Bearer ${profile.apiToken}`);
    dnsRequests.push({ zoneId, method: init.method || "GET", body });
    let records = zones.get(zoneId);
    if (!init.method || init.method === "GET") return Response.json({ success: true, result: records });
    const newRecord = (input) => ({ id: (++sequence).toString(16).padStart(8, "0"), ...input });
    if (url.pathname.endsWith("/batch")) {
      records = records.filter((record) => !body.deletes.some((item) => item.id === record.id));
      records = records.map((record) => ({ ...record, ...body.patches.find((item) => item.id === record.id) }));
      records.push(...body.posts.map(newRecord));
      zones.set(zoneId, records);
      return Response.json({ success: true, result: {} });
    }
    const id = url.pathname.split("/").at(-1);
    if (init.method === "DELETE") {
      zones.set(zoneId, records.filter((record) => record.id !== id));
      return Response.json({ success: true, result: {} });
    }
    if (init.method === "PUT") {
      records = records.map((record) => record.id === id ? { ...record, ...body } : record);
      zones.set(zoneId, records);
      return Response.json({ success: true, result: records.find((record) => record.id === id) });
    }
    assert.equal(init.method, "POST");
    const created = newRecord(body);
    records.push(created);
    return Response.json({ success: true, result: created });
  };
  const pendingKey = "telegram:pending:456:123";
  const pending = () => values.has(pendingKey) ? JSON.parse(values.get(pendingKey)) : undefined;
  const last = () => messages.filter((message) => message.text).at(-1);
  const buttons = () => (last()?.reply_markup?.inline_keyboard ?? []).flat();
  const records = () => zones.get("zone-1");
  async function send(text, userId = 123) {
    return webhook({ message: { text, from: { id: userId }, chat: { id: 456 } } });
  }
  async function callback(data) {
    return webhook({ callback_query: { id: "callback", data, from: { id: 123 }, message: { message_id: 1, chat: { id: 456 } } } });
  }
  async function webhook(update) {
    const response = await handleTelegramWebhook(new Request("https://worker.example/telegram/webhook", { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": "test-secret", "content-type": "application/json" }, body: JSON.stringify(update) }), env);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), "ok");
  }
  const saveSettings = () => values.set("settings", JSON.stringify(settings));

  await send("/start");
  assert.match(last().text, /泛域名同步已关闭/);
  await send("/help");
  assert.match(last().text, /\/add A www 1\.1\.1\.1/);
  // Guided add waits for a prefix, previews the full name, and creates only
  // that name. All supported types and multilevel/full-name inputs work.
  for (const [type, prefix, content, name] of [
    ["A", "www", "1.1.1.1", "www.example.com"],
    ["AAAA", "api.v2", "2606:4700:4700::1111", "api.v2.example.com"],
    ["CNAME", "AAA.EXAMPLE.COM.", "origin.example.net", "aaa.example.com"],
  ]) {
    await callback(`add:type:${type}`);
    assert.equal(pending().kind, "dns-name");
    assert.match(last().text, /只填前缀，例如：www/);
    await send(prefix);
    assert.equal(pending().kind, "add");
    assert.match(last().text, new RegExp(name.replaceAll(".", "\\.")));
    await send(content);
    assert.equal(pending(), undefined);
    assert(records().some((record) => record.name === name && record.type === type));
  }
  assert(!records().some((record) => record.name.startsWith("*.")));
  // Name retries and root shortcut never mutate DNS until content is sent.
  await callback("add:type:A");
  const beforeInvalid = records().length;
  await send("*");
  assert.match(last().text, /不支持泛域名/);
  assert.equal(pending().kind, "dns-name");
  assert.equal(records().length, beforeInvalid);
  await callback("dns-name:root");
  assert.equal(pending().name, "example.com");
  await callback("dns-name:change");
  await send("@");
  await send("2.2.2.2");
  assert(records().some((record) => record.name === "example.com"));

  const cname = records().find((record) => record.type === "CNAME");
  await callback(`record:${cname.id}`);
  assert(buttons().some((button) => button.text === "编辑子域名"));
  await callback(`edit-name:${cname.id}`);
  await send("renamed");
  assert.equal(pending().ready, true);
  assert.match(last().text, /renamed\.example\.com/);
  assert.equal(records().find((record) => record.id === cname.id).name, cname.name);
  await callback("dns-name:save");
  let renamed = records().find((record) => record.id === cname.id);
  assert.equal(renamed.name, "renamed.example.com");
  assert.equal(renamed.content, cname.content);
  assert.equal(renamed.type, "CNAME");
  await callback(`edit-name:${cname.id}`);
  await send("discarded");
  await callback("cancel");
  assert.equal(pending(), undefined);
  assert.equal(records().find((record) => record.id === cname.id).name, renamed.name);
  // A duplicate-name/content failure preserves both the record and pending
  // confirmation, letting the user correct the prefix.
  await send("/add CNAME taken origin.example.net");
  await callback(`edit-name:${cname.id}`);
  await send("taken");
  await callback("dns-name:save");
  assert.match(last().text, /已经存在/);
  assert.equal(pending().kind, "dns-name");
  await send("retry");
  await callback("dns-name:save");
  assert.equal(records().find((record) => record.id === cname.id).name, "retry.example.com");
  // Existing content-only commands must preserve the subdomain name.
  await send(`/update ${cname.id} CNAME replacement.example.net`);
  renamed = records().find((record) => record.id === cname.id);
  assert.equal(renamed.name, "retry.example.com");
  assert.equal(renamed.content, "replacement.example.net");
  await send(`/update ${cname.id} CNAME final replacement.example.net`);
  assert.equal(records().find((record) => record.id === cname.id).name, "final.example.com");
  await callback(`edit-options:${cname.id}`);
  assert(buttons().some((button) => button.text === "编辑子域名"));
  await callback(`edit:type:${cname.id}:CNAME`);
  assert.match(last().text, /final\.example\.com/);
  await send("changed.example.net");
  assert.equal(records().find((record) => record.id === cname.id).name, "final.example.com");

  await send("/bulk");
  assert.match(last().text, /www 1\.1\.1\.1/);
  const beforeBulk = structuredClone(records());
  const bulkText = beforeBulk.map((record) => `${record.type} ${record.name === "example.com" ? "@" : record.name.slice(0, -".example.com".length)} ${record.content}`).join("\n");
  await send(bulkText);
  assert.deepEqual(records(), beforeBulk);
  await send("/bulk");
  await send("www 1.1.1.1\napi.v2 2606:4700:4700::1111\n@ 2.2.2.2\nCNAME full.example.com origin.example.net");
  assert(records().some((record) => record.name === "full.example.com"));
  assert(!records().some((record) => record.name.startsWith("*.")));

  // A mode change rejects an old rename confirmation; fresh paired mode has
  // no prefix step or rename button, and still creates the wildcard pair.
  const apex = records().find((record) => record.name === "example.com");
  await callback(`edit-name:${apex.id}`);
  await send("blocked");
  profiles[0].syncWildcard = true;
  saveSettings();
  await callback("dns-name:save");
  assert.match(last().text, /泛域名同步已开启/);
  assert.equal(records().find((record) => record.id === apex.id).name, "example.com");
  await callback(`record:${apex.id}`);
  assert(!buttons().some((button) => button.text === "编辑子域名"));
  await callback(`edit-name:${apex.id}`);
  assert.match(last().text, /不能编辑子域名/);
  await callback("add:type:A");
  assert.equal(pending().kind, "add");
  assert(!buttons().some((button) => button.callback_data === "dns-name:change"));
  await send("3.3.3.3");
  assert(records().some((record) => record.name === "*.example.com" && record.content === "3.3.3.3"));
  const enabledCount = records().length;
  await send("/add A www 4.4.4.4");
  assert.match(last().text, /记录名称只能/);
  assert.equal(records().length, enabledCount);
  await send("/help");
  assert(!last().text.includes("/add A www"));

  // Changing domains clears old pending input and uses the new domain's token
  // and wildcard setting; unlisted users cannot create or alter DNS records.
  profiles[0].syncWildcard = false;
  saveSettings();
  await callback("add:type:A");
  await send("old");
  await callback("domain:secondary");
  assert.equal(pending(), undefined);
  await callback("add:type:A");
  assert.equal(pending().name, "other.example.net");
  await send("5.5.5.5");
  assert.equal(zones.get("zone-2").length, 2);
  assert(dnsRequests.filter((request) => request.zoneId === "zone-2").length > 0);
  const requestCount = dnsRequests.length;
  await send("/add A unauthorized 6.6.6.6", 999);
  assert.equal(dnsRequests.length, requestCount);
  console.log("Telegram prefix add/rename, confirmation/cancel, bulk/commands, mode/domain changes, and authorization: ok");
} finally {
  globalThis.fetch = originalFetch;
  rmSync(directory, { recursive: true, force: true });
}
