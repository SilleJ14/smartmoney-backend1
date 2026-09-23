// Link, but NEVER evaluate, the exact committed/staged server module graph.
// Run: node --experimental-vm-modules scripts/check-committed-module-graph.mjs [--staged]
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SourceTextModule, SyntheticModule } from "node:vm";
import { createRequire, isBuiltin } from "node:module";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const staged = process.argv.includes("--staged");
const require = createRequire(path.join(root, "package.json"));
const modules = new Map();
let localCount = 0;

async function load(specifier, parent) {
  const local = specifier.startsWith(".") || specifier.startsWith("file:");
  const url = local ? new URL(specifier, parent).href : specifier;
  if (modules.has(url)) return modules.get(url);
  if (local) {
    const relative = path.relative(root, fileURLToPath(url)).replaceAll("\\", "/");
    if (relative.startsWith("../")) throw new Error(`Import outside repository: ${relative}`);
    const source = execFileSync("git", ["show", `${staged ? "" : "HEAD"}:${relative}`], { cwd: root, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    const module = new SourceTextModule(source, { identifier: url });
    modules.set(url, module);
    localCount++;
    return module;
  }
  // External packages are ordinary installed dependencies; application code is never evaluated.
  const pending = (async () => {
    const resolved = isBuiltin(specifier) ? specifier : pathToFileURL(require.resolve(specifier)).href;
    const namespace = await import(resolved);
    return new SyntheticModule(Object.keys(namespace), function () {
      for (const name of Object.keys(namespace)) this.setExport(name, namespace[name]);
    }, { identifier: url });
  })();
  modules.set(url, pending);
  return pending;
}

const entry = await load(pathToFileURL(path.join(root, "server.js")).href);
await entry.link((specifier, parent) => load(specifier, parent.identifier));
console.log(`PASS: ${localCount} ${staged ? "staged" : "committed"} application modules linked; server not executed.`);
