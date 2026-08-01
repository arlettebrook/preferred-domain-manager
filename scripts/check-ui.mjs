import { readFileSync } from "node:fs";

const file = new URL("../src/ui/pages.ts", import.meta.url);
const source = readFileSync(file, "utf8");
const scripts = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

if (!scripts.length) throw new Error("无法找到管理页内嵌脚本");
scripts.forEach((script) => new Function(script));
console.log(`Embedded admin scripts syntax: ok (${scripts.length})`);
