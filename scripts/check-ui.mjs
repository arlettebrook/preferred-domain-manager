import { readFileSync } from "node:fs";

const entryFile = new URL("../src/ui/pages.ts", import.meta.url);
const pageFile = new URL("../src/ui/admin-page.ts", import.meta.url);
const clientFile = new URL("../src/ui/admin-client.ts", import.meta.url);
const stylesFile = new URL("../src/ui/admin-styles.ts", import.meta.url);
const landingFile = new URL("../src/ui/landing-page.ts", import.meta.url);
const redesignFile = new URL("../src/ui/redesign.ts", import.meta.url);
const entry = readFileSync(entryFile, "utf8");
const source = readFileSync(pageFile, "utf8");
const client = readFileSync(clientFile, "utf8");
const styles = readFileSync(stylesFile, "utf8");
const landing = readFileSync(landingFile, "utf8");
const redesign = readFileSync(redesignFile, "utf8");
const scripts = [
  ...source.matchAll(/<script>([\s\S]*?)<\/script>/g),
  ...client.matchAll(/<script>([\s\S]*?)<\/script>/g),
  ...landing.matchAll(/<script>([\s\S]*?)<\/script>/g),
  ...redesign.matchAll(/<script>([\s\S]*?)<\/script>/g),
].map((match) => match[1]);

if (!scripts.length) throw new Error("No embedded UI scripts found");
scripts.forEach((script) => new Function(script));
if (!entry.includes('from "./landing-page"') || !entry.includes('from "./admin-page"')) throw new Error("UI entry module missing");
if (!source.includes("export function adminPage")) throw new Error("adminPage template missing");
if (!landing.includes("export function landingPage")) throw new Error("landingPage template missing");
if (!redesign.includes("applyUiRedesign") || !redesign.includes("redesignCss")) throw new Error("redesign module missing");
if (!source.includes("admin-ui-assets") || !styles.includes("adminBaseStyles")) throw new Error("admin UI assets missing");
for (const marker of ['id="loginForm"', 'id="app"', 'id="dnsRows"', 'id="dnsDialog"']) {
  if (!source.includes(marker)) throw new Error(`Admin UI marker missing: ${marker}`);
}
for (const marker of ["ui-history-panel", "ui-dirty-banner", "ui-setup-guide", "prefers-reduced-motion"]) {
  if (!redesign.includes(marker)) throw new Error(`Redesign marker missing: ${marker}`);
}
console.log(`Embedded UI scripts syntax: ok (${scripts.length})`);
