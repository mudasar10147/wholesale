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

const child = spawn(process.execPath, [validateScript], {
  stdio: "inherit",
  env: { ...process.env, INVENTORY_VALIDATION_MODE: "nightly" },
});

child.on("exit", (code) => {
  process.exit(code ?? 1);
});
