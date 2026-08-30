// One-off helper: lists vehicles on your OnStar account so you can grab the
// right VIN and confirm auth works. Run with: npm run vehicles
import { config } from "../config.js";
import { OnStarClient } from "../onstar.js";

const onstar = new OnStarClient(config.onstar);

try {
  const result = await onstar.getAccountVehicles();
  console.log(JSON.stringify(result?.response?.data, null, 2));
} catch (err) {
  console.error("Failed to fetch vehicles:", err?.message ?? err);
  process.exit(1);
}
process.exit(0);
