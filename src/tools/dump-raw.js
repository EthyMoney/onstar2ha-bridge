// Debug helper: dumps raw diagnostics/location responses to ./debug/ for inspection.
import fs from "node:fs";
import { config } from "../config.js";
import { OnStarClient } from "../onstar.js";

const onstar = new OnStarClient(config.onstar);
fs.mkdirSync("./debug", { recursive: true });

for (const [name, fn] of [
  ["diagnostics", () => onstar.diagnostics()],
  ["location", () => onstar.location()],
]) {
  try {
    const result = await fn();
    fs.writeFileSync(`./debug/${name}.json`, JSON.stringify(result, null, 2));
    console.log(`${name}: saved (status=${result?.status})`);
  } catch (err) {
    console.error(`${name} failed:`, err?.message ?? err);
  }
}
process.exit(0);
