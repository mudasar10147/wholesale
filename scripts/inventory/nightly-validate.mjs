/**
 * Nightly inventory validation — same as validate.mjs, intended for CI/cron.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/sa.json npm run validate:inventory:nightly
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const validateScript = path.join(__dirname, "validate.mjs");
// The validator loads app lib modules that use the `@/` alias at runtime.
const aliasHook = path.join(__dirname, "..", "support", "registerTsAlias.mjs");

const child = spawn(process.execPath, ["--import", aliasHook, validateScript, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, INVENTORY_VALIDATION_MODE: "nightly" },
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
