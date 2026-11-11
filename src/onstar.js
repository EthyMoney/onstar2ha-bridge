import OnStar from "onstarjs2";
import { logger } from "./logger.js";
import { AuthGuard } from "./auth-guard.js";

// Serializes all OnStar calls (GM's API dislikes concurrent requests) and
// stops sending requests while the AuthGuard says the GM login is unusable.
export class OnStarClient {
  constructor(onstarConfig) {
    this.client = OnStar.create(onstarConfig);
    this.guard = new AuthGuard(onstarConfig.tokenLocation);
    this.queue = Promise.resolve();
  }

  // Reason requests are currently paused (string), or null when they can go out.
  blockedReason() {
    return this.guard.blockedReason();
  }

  call(name, fn) {
    const run = async () => {
      const blocked = this.guard.blockedReason();
      if (blocked) {
        throw new Error(`Skipping "${name}": ${blocked}`);
      }
      logger.debug(`OnStar request: ${name}`);
      const tokenStamp = this.guard.tokenStamp();
      try {
        const result = await fn(this.client);
        this.guard.recordSuccess();
        return result;
      } catch (err) {
        this.guard.recordFailure(err, tokenStamp);
        throw err;
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  diagnostics() {
    return this.call("diagnostics", (c) => c.diagnostics());
  }

  location() {
    return this.call("location", (c) => c.location());
  }

  getEVChargingMetrics() {
    return this.call("getEVChargingMetrics", (c) => c.getEVChargingMetrics());
  }

  refreshEVChargingMetrics() {
    return this.call("refreshEVChargingMetrics", (c) =>
      c.refreshEVChargingMetrics(),
    );
  }

  lockDoor() {
    return this.call("lockDoor", (c) => c.lockDoor());
  }

  unlockDoor() {
    return this.call("unlockDoor", (c) => c.unlockDoor());
  }

  start() {
    return this.call("start", (c) => c.start());
  }

  cancelStart() {
    return this.call("cancelStart", (c) => c.cancelStart());
  }

  flashLights() {
    return this.call("flashLights", (c) => c.flashLights());
  }

  stopLights() {
    return this.call("stopLights", (c) => c.stopLights());
  }

  stopCharging() {
    return this.call("stopCharging", (c) => c.stopCharging());
  }

  setChargeLevelTarget(tcl) {
    return this.call("setChargeLevelTarget", (c) => c.setChargeLevelTarget(tcl));
  }

  getAccountVehicles() {
    return this.call("getAccountVehicles", (c) => c.getAccountVehicles());
  }
}

// Extracts normalized diagnostic groups from the v3 healthstatus response.
// Shape: response.data.diagnostics[] -> { name, diagnosticElements[] { name, displayName, value, uom, status, description } }
export function extractDiagnostics(result) {
  const groups = result?.response?.data?.diagnostics ?? [];
  return groups.map((group) => ({
    name: group.name,
    elements: (group.diagnosticElements ?? []).map((el) => ({
      name: el.name,
      displayName: el.displayName,
      value: el.value,
      unit: el.uom && el.uom !== "N/A" ? el.uom : undefined,
      status: el.status,
      message: el.description,
    })),
  }));
}

// Extracts { lat, lon } from the v3 digital-twin location response.
// Shape: response.data.telemetry.data.position.{ lat, lng }
export function extractLocation(result) {
  const pos = result?.response?.data?.telemetry?.data?.position;
  if (typeof pos?.lat === "number" && typeof pos?.lng === "number") {
    return { lat: pos.lat, lon: pos.lng };
  }
  return undefined;
}
