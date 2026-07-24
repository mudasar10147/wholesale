/**
 * Node ESM resolver hook: maps the `@/` path alias (project root) to real files
 * and appends `.ts`/`.tsx` when needed, so scripts and emulator tests can import
 * app `lib/**` modules that use runtime `@/` imports. Node strips the TS types.
 *
 * Registered via scripts/support/registerTsAlias.mjs (`node --import ...`).
 */
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function resolveCandidate(base) {
  if (existsSync(base + ".ts")) return base + ".ts";
  if (existsSync(base + ".tsx")) return base + ".tsx";
  if (existsSync(base) && existsSync(path.join(base, "index.ts"))) return path.join(base, "index.ts");
  if (existsSync(base)) return base;
  return base + ".ts"; // let Node report a clear error if it truly doesn't exist
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    const base = path.join(ROOT, specifier.slice(2));
    return nextResolve(pathToFileURL(resolveCandidate(base)).href, context);
  }
  return nextResolve(specifier, context);
}
