/**
 * Bootstrap for the `@/` alias resolver hook. Use with:
 *   node --import ./scripts/support/registerTsAlias.mjs <script-or-test>
 */
import { register } from "node:module";

register("./tsAliasHooks.mjs", import.meta.url);
