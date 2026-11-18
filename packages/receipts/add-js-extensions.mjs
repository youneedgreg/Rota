/* global URL, console -- a Node build script */
// After `tsc`: the source imports its own files without an extension (as Next
// and Vitest expect), but Node's ES modules need one. Adds ".js" to every
// relative import in dist, in both the .js and the .d.ts files.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = new URL("./dist/", import.meta.url);
let changed = 0;
for (const name of readdirSync(dir)) {
  if (!name.endsWith(".js") && !name.endsWith(".d.ts")) continue;
  const file = new URL(name, dir);
  const before = readFileSync(file, "utf8");
  const after = before.replace(/(from\s+["'])(\.\.?\/[^"']+?)(["'])/g, (match, open, path, close) =>
    /\.(js|json)$/.test(path) ? match : `${open}${path}.js${close}`,
  );
  if (after !== before) {
    writeFileSync(file, after);
    changed++;
  }
}
console.log(`add-js-extensions: ${changed} files updated`);
