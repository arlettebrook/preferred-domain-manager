import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const output = join(tmpdir(), "preferred-domain-manager", "ip-source-parser.cjs");
mkdirSync(dirname(output), { recursive: true });
execFileSync(process.execPath, [join("node_modules", "esbuild", "bin", "esbuild"), "src/services/ip-source-parser.ts", "--bundle", "--platform=node", "--format=cjs", `--outfile=${output}`], { stdio: "ignore" });
const require = createRequire(import.meta.url);
const { collectIpEntries, regionSummary } = require(output);

const sample = [
  "2.27.109.144:443#HK",
  "45.136.14.61:2053#HK",
  "8.222.193.153:443#JP",
  "191.222.212.49:443#JP\u2022Tokyo",
  "103.117.100.17:3443#hk\u2022Server",
  "1.1.1.1",
  "[2606:4700:4700::1111]:443#US",
].join("\n");
const entries = collectIpEntries(sample);
const summary = regionSummary(entries);
const byIp = new Map(entries.map((entry) => [entry.ip, entry.regions]));

if (byIp.has("45.136.14.61") || byIp.has("103.117.100.17")) throw new Error("Non-443 endpoints were not rejected");
if (!byIp.get("2.27.109.144")?.includes("HK")) throw new Error("HK parsing failed");
if (!byIp.get("8.222.193.153")?.includes("JP") || !byIp.get("191.222.212.49")?.includes("JP")) throw new Error("JP parsing failed");
if (!summary.regions.includes("HK") || !summary.regions.includes("JP")) throw new Error("Region summary failed");
if (!byIp.has("1.1.1.1")) throw new Error("Untagged valid IP was not preserved");

const realSample = join(".wrangler", "region-api-sample.txt");
if (existsSync(realSample)) {
  const realEntries = collectIpEntries(readFileSync(realSample, "utf8"));
  const realSummary = regionSummary(realEntries);
  const selected = new Set(["HK", "JP"]);
  const filtered = realEntries.filter((entry) => !entry.regions.length || entry.regions.some((region) => selected.has(region)));
  if (!realSummary.regions.includes("HK") || !realSummary.regions.includes("JP")) throw new Error("Real API did not expose HK/JP");
  if (filtered.some((entry) => entry.regions.length && !entry.regions.some((region) => selected.has(region)))) throw new Error("Real API filter included an unselected region");
}

rmSync(output, { force: true });
console.log("IP source region parsing: ok");
