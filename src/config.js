import "dotenv/config";

function required(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

export const config = {
  onstar: {
    deviceId: required("ONSTAR_DEVICE_ID"),
    vin: required("ONSTAR_VIN").toUpperCase(),
    username: required("ONSTAR_USERNAME"),
    password: required("ONSTAR_PASSWORD"),
    onStarPin: required("ONSTAR_PIN"),
    onStarTOTP: required("ONSTAR_TOTP_KEY"),
    tokenLocation: process.env.ONSTAR_TOKEN_LOCATION || "./tokens/",
    checkRequestStatus: true,
  },
  poll: {
    intervalMs:
      Math.max(5, Number(process.env.POLL_INTERVAL_MINUTES) || 30) * 60_000,
    location: (process.env.POLL_LOCATION ?? "true").toLowerCase() === "true",
  },
  mqtt: {
    url: process.env.MQTT_URL || "mqtt://localhost:1883",
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    topicPrefix: process.env.MQTT_TOPIC_PREFIX || "onstar2ha",
    discoveryPrefix: process.env.HA_DISCOVERY_PREFIX || "homeassistant",
  },
  vehicleName: process.env.VEHICLE_NAME || "Blazer EV",
  logLevel: process.env.LOG_LEVEL || "info",
};
