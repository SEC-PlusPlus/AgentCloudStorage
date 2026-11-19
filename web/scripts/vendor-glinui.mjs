#!/usr/bin/env node
// vendor-glinui.mjs — PATH A registry fetcher (Task 2 mechanism; Task 13 swap).
//
// Fetches Glin UI registry items from https://glinui.com/r/items/<name>.json,
// BFS-resolves `registryDependencies` closure, and writes component/lib files
// into src/components/glinui/{components,lib}/ with a provenance header.
// Prints the union of npm `dependencies` for the fetched closure.
//
// Usage (from web/):
//   node scripts/vendor-glinui.mjs glass-dock glass-navbar ... [--out src/components/glinui] [--dry]
//
// No third-party deps: global fetch (Node >= 18), AbortController timeout.

const REGISTRY_BASE = "https://glinui.com/r";
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_RETRIES = 5;

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const outIdx = args.indexOf("--out");
const OUT_DIR = outIdx >= 0 ? args[outIdx + 1] : "src/components/glinui";
const names = args.filter((a, i) => !a.startsWith("--") && i !== outIdx + 1);

if (names.length === 0) {
  console.error("error: pass at least one registry item name");
  process.exit(1);
}

async function fetchJson(url) {
  let lastErr;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      const wait = attempt * 2000;
      console.error(`  retry ${attempt}/${FETCH_RETRIES} for ${url} (${err.message}) in ${wait}ms`);
      await new Promise((r) => setTimeout(r, wait));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`failed after ${FETCH_RETRIES} attempts: ${url} (${lastErr})`);
}

// BFS closure over registryDependencies.
const seen = new Map(); // name -> item json
const queue = [...names];
const missing = [];
while (queue.length > 0) {
  const name = queue.shift();
  if (seen.has(name)) continue;
  try {
    const item = await fetchJson(`${REGISTRY_BASE}/items/${name}.json`);
    seen.set(name, item);
    for (const dep of item.registryDependencies ?? []) {
      const depName = dep.split("/").pop().replace(/\.json$/, "");
      if (!seen.has(depName)) queue.push(depName);
    }
  } catch (err) {
    console.error(`MISSING: ${name} — ${err.message}`);
    missing.push(name);
  }
}

// Map registry file paths into the local vendored tree.
const { mkdir, writeFile } = await import("node:fs/promises");
const path = await import("node:path");
const date = new Date().toISOString().slice(0, 10);
const depUnion = new Set();
let fileCount = 0;

for (const [name, item] of seen) {
  for (const dep of item.dependencies ?? []) depUnion.add(dep);
  for (const file of item.files ?? []) {
    let rel;
    if (file.path.includes("packages/ui/src/components/")) {
      rel = path.join("components", path.basename(file.path));
    } else if (file.path.includes("packages/ui/src/lib/")) {
      rel = path.join("lib", path.basename(file.path));
    } else {
      console.warn(`skip (unmapped path): ${name} ${file.path}`);
      continue;
    }
    const target = path.join(OUT_DIR, rel);
    const header = `// vendored from glinui.com/r/${name}.json @${date}\n`;
    if (dry) {
      console.log(`would write ${target} (${(file.content ?? "").length} bytes)`);
    } else {
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, header + (file.content ?? ""), "utf8");
    }
    fileCount++;
  }
}

console.log(`\nitems fetched: ${seen.size}${missing.length ? ` (missing: ${missing.join(", ")})` : ""}`);
console.log(`files written: ${fileCount}${dry ? " (dry run)" : ""} -> ${OUT_DIR}`);
console.log(`note: lib/cn.ts is hand-written, never shipped with items`);
console.log(`npm dependency union:\n  ${[...depUnion].sort().join("\n  ")}`);
process.exit(missing.length > 0 && missing.length === seen.size ? 1 : 0);
