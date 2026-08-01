import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadTypeScript(relativePath, stubs = {}) {
  const source = readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: (request) => stubs[request] ?? {},
    crypto: globalThis.crypto,
    TextEncoder,
    Uint8Array,
    Request,
    Response,
    Headers,
    URL,
    URLSearchParams,
    btoa,
    atob,
    AbortController,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    Promise,
    String,
    RegExp,
    Error,
  };
  vm.runInNewContext(output, context, { filename: relativePath });
  return module.exports;
}

const errors = loadTypeScript("src/errors.ts");
const validation = loadTypeScript("src/validation.ts");
const session = loadTypeScript("src/security/session.ts", {
  "../config": { SESSION_COOKIE: "pdm_session", SESSION_TTL_SECONDS: 3600 },
});
const http = loadTypeScript("src/http.ts", { "./errors": errors });
const dnsHistory = loadTypeScript("src/services/dns-history.ts", { "../config": { DNS_HISTORY_LIMIT: 50 } });

class MemoryKv {
  values = new Map();

  async get(key, type) {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === "json" ? JSON.parse(value) : value;
  }

  async put(key, value) { this.values.set(key, String(value)); }
  async delete(key) { this.values.delete(key); }
}

const settings = {
  ipSources: [],
  manualIps: [],
  domains: [],
  defaultDomain: "",
  cfZoneId: "",
  telegramAllowedUserIds: [],
  updatedAt: new Date().toISOString(),
};
const kv = new MemoryKv();
const dnsRecords = [];
let nextRecordId = 1;
const settingsService = {
  domainProfiles: (value) => Array.isArray(value.domains) ? value.domains : [],
  effectiveApiToken: (value, domainId) => value.domains?.find((profile) => profile.id === domainId || !domainId)?.apiToken,
  effectiveTarget: (value, domainId) => {
    const profile = value.domains?.find((item) => item.id === domainId) || value.domains?.[0];
    return profile ? { zoneId: profile.zoneId, domain: profile.domain, syncWildcard: profile.syncWildcard !== false } : undefined;
  },
  getSettings: async () => settings,
  publicSettings: (value) => ({ ...value, domains: [], hasCfApiToken: false, hasTelegramBotToken: false, hasTelegramWebhookSecret: false }),
};
const fakeDns = {
  createDnsRecord: async (target, input) => {
    const record = { id: `record-${nextRecordId++}`, type: String(input.type), name: String(input.name), content: String(input.content), ttl: 60, proxied: false };
    dnsRecords.push(record);
    return record;
  },
  deleteDnsRecord: async (_target, id) => {
    const index = dnsRecords.findIndex((record) => record.id === id);
    if (index >= 0) dnsRecords.splice(index, 1);
  },
  isEditableDnsRecord: (target, record) => [target.domain, `*.${target.domain}`].includes(record.name) && ["A", "AAAA", "CNAME"].includes(record.type),
  listDnsRecords: async () => dnsRecords.map((record) => ({ ...record })),
  restoreDnsRecords: async (_target, snapshot) => {
    dnsRecords.splice(0, dnsRecords.length, ...snapshot.map((record) => ({ ...record, ttl: record.ttl ?? 60, proxied: record.proxied ?? false })));
    return dnsRecords.map((record) => ({ ...record }));
  },
  updateDnsRecord: async (_target, id, input) => {
    const record = dnsRecords.find((item) => item.id === id);
    Object.assign(record, { type: String(input.type), name: String(input.name), content: String(input.content) });
    return { ...record };
  },
};
const api = loadTypeScript("src/api.ts", {
  "./config": { SETTINGS_KEY: "settings", SYNC_STATE_KEY: "sync:state", DEFAULT_ADMIN_PATH: "/admin" },
  "./security/session": session,
  "./services/ip-sources": { collectPreferredIps: async () => ({ merged: [], reachable: [], sources: [] }) },
  "./services/settings": settingsService,
  "./services/dns-history": dnsHistory,
  "./services/sync": { runSync: async () => ({ ok: true }) },
  "./services/cloudflare-dns": fakeDns,
  "./types": {},
  "./validation": validation,
  "./errors": errors,
  "./http": http,
  "./services/telegram": {
    deleteTelegramWebhook: async () => undefined,
    setTelegramCommands: async () => undefined,
    setTelegramWebhook: async () => "",
    telegramBotInfo: async () => ({}),
  },
});

const env = {
  ADMIN_PASSWORD: "test-password",
  SESSION_SECRET: "test-session-secret",
  PDM_KV: kv,
};

function request(path, init = {}) {
  return new Request(`https://example.com${path}`, init);
}

async function callApi(input, runtimeEnv = env) {
  try {
    return await api.handleApi(input, runtimeEnv);
  } catch (error) {
    if (error instanceof errors.HttpError) return http.json({ error: error.message }, error.status, error.headers);
    throw error;
  }
}

function cookieFrom(response) {
  return response.headers.get("set-cookie")?.split(";", 1)[0] || "";
}

test("API authentication and health flow work end to end", async () => {
  const unauthorized = await callApi(request("/api/health"));
  assert.equal(unauthorized.status, 401);

  const invalid = await callApi(request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": "198.51.100.10" },
    body: JSON.stringify({ password: "wrong-password" }),
  }));
  assert.equal(invalid.status, 401);

  const login = await callApi(request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": "198.51.100.11" },
    body: JSON.stringify({ password: "test-password" }),
  }));
  assert.equal(login.status, 200);
  const cookie = cookieFrom(login);
  assert.match(cookie, /^pdm_session=/);

  const health = await callApi(request("/api/health", { headers: { cookie } }));
  assert.equal(health.status, 200);
  const payload = await health.json();
  assert.equal(payload.ready, false);
  assert.deepEqual(payload.domains, []);
});

test("API rejects cross-origin mutations and rate-limits failed logins", async () => {
  const headers = { "content-type": "application/json", "CF-Connecting-IP": "198.51.100.12" };
  for (let attempt = 0; attempt < 8; attempt++) {
    const response = await callApi(request("/api/auth/login", { method: "POST", headers, body: JSON.stringify({ password: "wrong" }) }));
    assert.equal(response.status, 401);
  }
  const limited = await callApi(request("/api/auth/login", { method: "POST", headers, body: JSON.stringify({ password: "wrong" }) }));
  assert.equal(limited.status, 429);
  assert.match(limited.headers.get("retry-after") || "", /^\d+$/);

  const login = await callApi(request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": "198.51.100.13" },
    body: JSON.stringify({ password: "test-password" }),
  }));
  const cookie = cookieFrom(login);
  const response = await callApi(request("/api/config", {
    method: "PUT",
    headers: { cookie, origin: "https://attacker.example", "content-type": "application/json" },
    body: JSON.stringify({ domains: [] }),
  }));
  assert.equal(response.status, 403);
});

test("DNS mutations create history and rollback restores the previous snapshot", async () => {
  settings.domains = [{ id: "domain:example.com", domain: "example.com", zoneId: "zone-1", apiToken: "test-token" }];
  settings.defaultDomain = "example.com";
  settings.cfZoneId = "zone-1";
  dnsRecords.splice(0, dnsRecords.length);

  const login = await callApi(request("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json", "CF-Connecting-IP": "198.51.100.14" },
    body: JSON.stringify({ password: "test-password" }),
  }));
  const cookie = cookieFrom(login);
  const query = "?domainId=domain%3Aexample.com";
  const created = await callApi(request(`/api/dns/records${query}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ type: "A", name: "example.com", content: "1.1.1.1" }),
  }));
  assert.equal(created.status, 201);
  const recordId = (await created.json()).record.id;

  const historyResponse = await callApi(request(`/api/dns/history${query}`, { headers: { cookie } }));
  const history = await historyResponse.json();
  assert.equal(history.history.length, 1);
  assert.equal(history.history[0].action, "create");

  const rollback = await callApi(request(`/api/dns/history/${history.history[0].id}/rollback${query}`, { method: "POST", headers: { cookie } }));
  assert.equal(rollback.status, 200);
  assert.deepEqual((await rollback.json()).records, []);
  assert.equal(dnsRecords.find((record) => record.id === recordId), undefined);
});
