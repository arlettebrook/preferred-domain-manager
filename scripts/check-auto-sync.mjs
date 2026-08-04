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

for (const [name, source, markers] of [
  ["types", types, ["autoSyncEnabled?: boolean"]],
  ["settings", settings, ["autoSyncEnabled: item.autoSyncEnabled === true", "autoSyncEnabled: false"]],
  ["api", api, ["autoSyncEnabled: item.autoSyncEnabled !== undefined", "autoSyncEnabled: false"]],
  ["sync", sync, ["automatic?: boolean", "profiles.filter((profile) => profile.autoSyncEnabled === true)", "同步请求必须指定域名", "automatic,"]],
  ["cron", lock, ["runSync(this.env, { automatic: true })", "reason: \"no-enabled-domains\"", "profile.autoSyncEnabled === true"]],
  ["ui", ui, ["auto-sync-enabled", "自动同步域名：", "自动优选同步"]],
]) {
  for (const marker of markers) {
    if (!source.includes(marker)) throw new Error(`${name} 缺少自动同步约束：${marker}`);
  }
}

const output = join(tmpdir(), "preferred-domain-manager", "settings-auto-sync.cjs");
mkdirSync(dirname(output), { recursive: true });
execFileSync(process.execPath, [join("node_modules", "esbuild", "bin", "esbuild"), "src/services/settings.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${output}`], { stdio: "ignore" });
const require = createRequire(import.meta.url);
const { domainProfiles } = require(output);

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

rmSync(output, { force: true });

console.log("Per-domain automatic sync checks: ok");
