/**
 * Node ESM resolver hook. Two jobs, both about letting scripts and emulator tests import
 * app `lib/**` modules written for the bundler rather than for Node:
 *   - maps the `@/` path alias to real files under the project root
 *   - appends `.ts`/`.tsx` to extensionless relative imports, which TypeScript allows and
 *     Node's ESM resolver does not (this is what broke `npm run test:engagement`)
 * Node strips the TS types.
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

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // TypeScript source omits the extension on relative imports ("./foo"), which Node's
    // ESM resolver rejects. Only reached after normal resolution has already failed, so
    // package specifiers and explicit extensions are untouched.
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    if (!isRelative || err?.code !== "ERR_MODULE_NOT_FOUND") throw err;

    const parentDir = context.parentURL?.startsWith("file:")
      ? path.dirname(fileURLToPath(context.parentURL))
      : ROOT;
    const candidate = resolveCandidate(path.resolve(parentDir, specifier));
    if (!existsSync(candidate)) throw err;
    return nextResolve(pathToFileURL(candidate).href, context);
  }
}
