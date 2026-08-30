import mqtt from "mqtt";
import { config } from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { Discovery } from "./ha-discovery.js";
import { OnStarClient, extractDiagnostics, extractLocation } from "./onstar.js";

setLogLevel(config.logLevel);

const discovery = new Discovery({
  discoveryPrefix: config.mqtt.discoveryPrefix,
  topicPrefix: config.mqtt.topicPrefix,
  vin: config.onstar.vin,
  vehicleName: config.vehicleName,
});
const base = discovery.base;
const onstar = new OnStarClient(config.onstar);

logger.info(`Connecting to MQTT broker at ${config.mqtt.url}`);
const client = mqtt.connect(config.mqtt.url, {
  username: config.mqtt.username,
  password: config.mqtt.password,
  will: {
    topic: discovery.availabilityTopic,
    payload: "offline",
    retain: true,
  },
});

function publish(topic, payload, retain = true) {
  const message =
    typeof payload === "string" ? payload : JSON.stringify(payload);
  client.publish(topic, message, { retain });
}

const announcedSensors = new Set();

function publishStaticDiscovery() {
  const entities = [
    discovery.deviceTracker(),
    discovery.lock(),
    discovery.chargeTargetNumber(),
    discovery.evMetricsSensor(),
    discovery.lastPollSensor(),
    discovery.pollStatusSensor(),
    discovery.button("refresh", "Refresh Data", "refresh", "mdi:refresh"),
    discovery.button("refresh_ev", "Refresh EV Metrics (Wake Vehicle)", "refresh_ev", "mdi:ev-station"),
    discovery.button("flash_lights", "Flash Lights", "flash_lights", "mdi:car-light-high"),
    discovery.button("stop_lights", "Stop Lights", "stop_lights", "mdi:car-light-dimmed"),
    discovery.button("start_vehicle", "Start Vehicle", "start", "mdi:car-key"),
    discovery.button("cancel_start", "Cancel Start", "cancel_start", "mdi:car-off"),
    discovery.button("stop_charging", "Stop Charging", "stop_charging", "mdi:battery-off"),
  ];
  for (const { topic, payload } of entities) {
    publish(topic, payload);
  }
  logger.info(`Published discovery for ${entities.length} static entities`);
}

async function pollDiagnostics() {
  const result = await onstar.diagnostics();
  const groups = extractDiagnostics(result);
  let count = 0;
  for (const group of groups) {
    for (const element of group.elements) {
      if (element.value === undefined || element.value === "") continue;
      const { topic, payload, objectId } = discovery.diagnosticSensor(
        group.name,
        element,
      );
      if (!announcedSensors.has(objectId)) {
        publish(topic, payload);
        announcedSensors.add(objectId);
      }
      publish(`${base}/sensor/${objectId}/state`, String(element.value));
      publish(`${base}/sensor/${objectId}/attributes`, {
        group: group.name,
        status: element.status,
        message: element.message,
        unit: element.unit,
      });
      count++;
    }
  }
  logger.info(`Published ${count} diagnostic values (${groups.length} groups)`);
}

async function pollEVMetrics(forceRefresh = false) {
  const result = forceRefresh
    ? await onstar.refreshEVChargingMetrics()
    : await onstar.getEVChargingMetrics();
  const data = result?.response?.data;
  if (!data) {
    logger.warn("EV charging metrics returned no data");
    return;
  }
  publish(`${base}/ev/state`, new Date().toISOString());
  publish(`${base}/ev/attributes`, data);
  const target = deepFind(data, (key) => /^(tcl|targetChargeLevel)$/i.test(key));
  if (typeof target === "number" && target >= 0 && target <= 100) {
    publish(`${base}/charge_target/state`, String(target));
  }
  logger.info("Published EV charging metrics");
}

async function pollLocation() {
  const result = await onstar.location();
  const loc = extractLocation(result);
  if (!loc) {
    logger.warn("Location request returned no coordinates");
    return;
  }
  publish(`${base}/device_tracker/attributes`, {
    latitude: loc.lat,
    longitude: loc.lon,
    gps_accuracy: 10,
  });
  publish(`${base}/device_tracker/state`, "not_home");
  logger.info(`Published location ${loc.lat}, ${loc.lon}`);
}

let polling = false;

async function pollAll({ forceEVRefresh = false } = {}) {
  if (polling) {
    logger.warn("Poll already in progress, skipping");
    return;
  }
  polling = true;
  publish(`${base}/poll_status/state`, "polling");
  const tasks = [
    ["diagnostics", pollDiagnostics],
    ["ev", () => pollEVMetrics(forceEVRefresh)],
  ];
  if (config.poll.location) tasks.push(["location", pollLocation]);

  let failures = 0;
  for (const [name, task] of tasks) {
    try {
      await task();
    } catch (err) {
      failures++;
      logger.error(`Poll task "${name}" failed:`, err?.message ?? err);
    }
  }
  publish(`${base}/last_poll/state`, new Date().toISOString());
  publish(
    `${base}/poll_status/state`,
    failures === 0 ? "ok" : `${failures} task(s) failed`,
  );
  polling = false;
}

async function runCommand(name, fn, after) {
  logger.info(`Command received: ${name}`);
  try {
    await fn();
    logger.info(`Command succeeded: ${name}`);
    if (after) after();
  } catch (err) {
    logger.error(`Command failed: ${name}:`, err?.message ?? err);
  }
}

function handleMessage(topic, messageBuffer) {
  const message = messageBuffer.toString().trim();
  if (topic === `${base}/lock/set`) {
    if (message === "LOCK") {
      runCommand("lockDoor", () => onstar.lockDoor(), () =>
        publish(`${base}/lock/state`, "LOCKED"),
      );
    } else if (message === "UNLOCK") {
      runCommand("unlockDoor", () => onstar.unlockDoor(), () =>
        publish(`${base}/lock/state`, "UNLOCKED"),
      );
    }
    return;
  }
  if (topic === `${base}/charge_target/set`) {
    const tcl = Number(message);
    if (Number.isInteger(tcl) && tcl >= 0 && tcl <= 100) {
      runCommand(`setChargeLevelTarget(${tcl})`, () =>
        onstar.setChargeLevelTarget(tcl), () =>
        publish(`${base}/charge_target/state`, String(tcl)),
      );
    } else {
      logger.warn(`Invalid charge target: ${message}`);
    }
    return;
  }
  if (topic === `${base}/command`) {
    switch (message) {
      case "refresh":
        pollAll();
        break;
      case "refresh_ev":
        pollAll({ forceEVRefresh: true });
        break;
      case "flash_lights":
        runCommand("flashLights", () => onstar.flashLights());
        break;
      case "stop_lights":
        runCommand("stopLights", () => onstar.stopLights());
        break;
      case "start":
        runCommand("start", () => onstar.start());
        break;
      case "cancel_start":
        runCommand("cancelStart", () => onstar.cancelStart());
        break;
      case "stop_charging":
        runCommand("stopCharging", () => onstar.stopCharging());
        break;
      default:
        logger.warn(`Unknown command: ${message}`);
    }
  }
}

function deepFind(obj, keyPredicate) {
  if (obj === null || typeof obj !== "object") return undefined;
  for (const [key, value] of Object.entries(obj)) {
    if (keyPredicate(key) && (typeof value === "number" || typeof value === "string")) {
      return typeof value === "string" ? Number(value) : value;
    }
    const found = deepFind(value, keyPredicate);
    if (found !== undefined) return found;
  }
  return undefined;
}

client.on("connect", () => {
  logger.info("MQTT connected");
  publish(discovery.availabilityTopic, "online");
  publishStaticDiscovery();
  client.subscribe([
    `${base}/command`,
    `${base}/lock/set`,
    `${base}/charge_target/set`,
  ]);
  // Home Assistant asks retained discovery to settle before states; poll shortly after startup.
  setTimeout(() => pollAll(), 5_000);
});

client.on("message", handleMessage);
client.on("error", (err) => logger.error("MQTT error:", err.message));

setInterval(() => pollAll(), config.poll.intervalMs);
logger.info(
  `Polling every ${Math.round(config.poll.intervalMs / 60000)} minutes for VIN ${config.onstar.vin}`,
);

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down`);
    client.publish(discovery.availabilityTopic, "offline", { retain: true }, () => {
      client.end(false, () => process.exit(0));
    });
  });
}
