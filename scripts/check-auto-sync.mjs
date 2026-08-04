import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const types = read("src/types.ts");
const settings = read("src/services/settings.ts");
const api = read("src/api.ts");
const sync = read("src/services/sync.ts");
const lock = read("src/durable-objects/sync-lock.ts");
const ui = read("src/ui/admin-page.ts");

const cronConfigRoute = api.slice(api.indexOf('if (url.pathname === "/api/cron/config"'), api.indexOf('if (url.pathname === "/api/ip-sources"'));
if (cronConfigRoute.includes("PDM_KV.put")) throw new Error("定时任务开关仍同时写入 KV 与 Durable Object");
if (!api.includes("const { cronEnabled: _legacyCronEnabled, ...baseSettings } = previous")) throw new Error("普通配置保存仍可能保留旧 cronEnabled 字段");

for (const [name, source, markers] of [
  ["types", types, ["autoSyncEnabled?: boolean"]],
  ["settings", settings, ["autoSyncEnabled: item.autoSyncEnabled === true", "autoSyncEnabled: false"]],
  ["api", api, ["autoSyncEnabled: item.autoSyncEnabled !== undefined", "autoSyncEnabled: false", "updateCronConfig(env, body.enabled", "getCronConfig(env)", "https://probe/cron/config", "publicSettings({ ...settings, cronEnabled: currentCronConfig.enabled })"]],
  ["sync", sync, ["automatic?: boolean", "profiles.filter((profile) => profile.autoSyncEnabled === true)", "同步请求必须指定域名", "automatic,"]],
  ["cron", lock, ["runSync(this.env, { automatic: true })", "reason: \"no-enabled-domains\"", "profile.autoSyncEnabled === true", "error instanceof LockBusyError", "setAlarm(Date.now() + 5000)", "CronConfigState", "path === \"/cron/config\"", "request.method === \"GET\"", "enabled: cronConfig.enabled", "await this.state.storage.put(\"cronConfig\", migrated)"]],
  ["ui", ui, ["auto-sync-enabled", "自动同步域名：", "自动优选同步", "let dnsLoadSequence=0", "requestId!==dnsLoadSequence", "dnsState.records=[];dnsState.loading=configured", "没有域名参与自动同步"]],
]) {
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${name} 缺少自动同步约束：${marker}`);
  }
}

const output = join(tmpdir(), "preferred-domain-manager", "settings-auto-sync.cjs");
const lockOutput = join(tmpdir(), "preferred-domain-manager", "sync-lock-auto-sync.cjs");
mkdirSync(dirname(output), { recursive: true });
execFileSync(process.execPath, [join("node_modules", "esbuild", "bin", "esbuild"), "src/services/settings.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${output}`], { stdio: "ignore" });
execFileSync(process.execPath, [join("node_modules", "esbuild", "bin", "esbuild"), "src/durable-objects/sync-lock.ts", "--bundle", "--platform=node", "--format=cjs", "--alias:cloudflare:sockets=./scripts/cloudflare-sockets-shim.mjs", `--outfile=${lockOutput}`], { stdio: "ignore" });
const require = createRequire(import.meta.url);
const { domainProfiles } = require(output);
const { SyncLock } = require(lockOutput);

const profiles = domainProfiles({
  domains: [
    { id: "enabled", domain: "enabled.example", zoneId: "zone-1", autoSyncEnabled: true },
    { id: "legacy", domain: "legacy.example", zoneId: "zone-2" },
  ],
});
if (profiles[0]?.autoSyncEnabled !== true) throw new Error("显式开启的域名未保留自动同步状态");
if (profiles[1]?.autoSyncEnabled !== false) throw new Error("旧域名配置没有默认关闭自动同步");

const legacyProfile = domainProfiles({ defaultDomain: "single.example", cfZoneId: "zone-3" });
if (legacyProfile[0]?.autoSyncEnabled !== false) throw new Error("旧版单域名配置没有默认关闭自动同步");

const storageValues = new Map();
const storage = {
  get: async (key) => storageValues.get(key),
  put: async (key, value) => { storageValues.set(key, value); },
  delete: async (key) => { storageValues.delete(key); },
  deleteAlarm: async () => {},
  getAlarm: async () => null,
};
const staleKvSettings = { ipSources: [], manualIps: [], domains: [], cronEnabled: true, updatedAt: "kv-stale" };
const env = { PDM_KV: { get: async () => staleKvSettings } };
const cronLock = new SyncLock({ storage }, env);
const disabledWrite = await cronLock.fetch(new Request("https://probe/cron/config", { method: "PUT", body: JSON.stringify({ enabled: false, updatedAt: "do-current" }) }));
if (!disabledWrite.ok) throw new Error("关闭定时任务未能写入 Durable Object");
const disabledStatus = await (await cronLock.fetch(new Request("https://probe/cron/config"))).json();
if (disabledStatus.cronEnabled !== false) throw new Error("Durable Object 未保持关闭状态");
const disabledStart = await (await cronLock.fetch(new Request("https://probe/cron/start", { method: "POST" }))).json();
if (disabledStart.reason !== "disabled") throw new Error("KV 返回旧开启状态时 Cron 仍被错误启动");
await cronLock.fetch(new Request("https://probe/cron/config", { method: "PUT", body: JSON.stringify({ enabled: true, updatedAt: "do-newer" }) }));
const enabledStatus = await (await cronLock.fetch(new Request("https://probe/cron/config"))).json();
if (enabledStatus.cronEnabled !== true) throw new Error("Durable Object 未恢复开启状态");

rmSync(output, { force: true });
rmSync(lockOutput, { force: true });

console.log("Per-domain automatic sync checks: ok");
