import { readFileSync } from "node:fs";

const file = new URL("../src/ui/pages.ts", import.meta.url);
const source = readFileSync(file, "utf8");
const start = source.indexOf("<script>") + "<script>".length;
const end = source.indexOf("</script>", start);

if (start < "<script>".length || end < 0) {
  throw new Error("无法找到管理页内嵌脚本");
}

new Function(source.slice(start, end));
console.log("Embedded admin script syntax: ok");
