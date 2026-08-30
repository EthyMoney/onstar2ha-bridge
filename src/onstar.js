import OnStar from "onstarjs2";
import { logger } from "./logger.js";

// Serializes all OnStar calls (GM's API dislikes concurrent requests) and
// backs off for several hours when auth is blocked with "Access Denied".
export class OnStarClient {
  constructor(onstarConfig) {
    this.client = OnStar.create(onstarConfig);
    this.queue = Promise.resolve();
    this.blockedUntil = 0;
  }

  call(name, fn) {
    const run = async () => {
      if (Date.now() < this.blockedUntil) {
        throw new Error(
          `Skipping "${name}": auth blocked until ${new Date(this.blockedUntil).toISOString()} after Access Denied`,
        );
      }
      logger.debug(`OnStar request: ${name}`);
      try {
        return await fn(this.client);
      } catch (err) {
        if (/access denied/i.test(err?.message ?? "")) {
          // GM bot detection: retrying immediately makes it worse.
          this.blockedUntil = Date.now() + 6 * 60 * 60 * 1000;
          logger.error(
            `Access Denied from GM auth. Pausing all requests until ${new Date(this.blockedUntil).toISOString()}.`,
          );
        }
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
