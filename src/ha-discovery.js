// Builds Home Assistant MQTT discovery payloads and maps OnStar diagnostic
// units/names to HA device classes.

export function slugify(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const UNIT_MAP = {
  km: { unit: "km", deviceClass: "distance", stateClass: "measurement" },
  mi: { unit: "mi", deviceClass: "distance", stateClass: "measurement" },
  kpa: { unit: "kPa", deviceClass: "pressure", stateClass: "measurement" },
  psi: { unit: "psi", deviceClass: "pressure", stateClass: "measurement" },
  bar: { unit: "bar", deviceClass: "pressure", stateClass: "measurement" },
  cel: { unit: "°C", deviceClass: "temperature", stateClass: "measurement" },
  "°c": { unit: "°C", deviceClass: "temperature", stateClass: "measurement" },
  fah: { unit: "°F", deviceClass: "temperature", stateClass: "measurement" },
  volts: { unit: "V", deviceClass: "voltage", stateClass: "measurement" },
  v: { unit: "V", deviceClass: "voltage", stateClass: "measurement" },
  kwh: { unit: "kWh", deviceClass: "energy", stateClass: "total_increasing" },
  kw: { unit: "kW", deviceClass: "power", stateClass: "measurement" },
  l: { unit: "L", deviceClass: "volume", stateClass: "measurement" },
  gal: { unit: "gal", deviceClass: "volume", stateClass: "measurement" },
  "%": { unit: "%", deviceClass: null, stateClass: "measurement" },
  sec: { unit: "s", deviceClass: "duration", stateClass: "measurement" },
  min: { unit: "min", deviceClass: "duration", stateClass: "measurement" },
  days: { unit: "d", deviceClass: null, stateClass: "measurement" },
};

function classify(elementName, rawUnit, value) {
  const name = elementName.toLowerCase();
  const info = UNIT_MAP[String(rawUnit || "").toLowerCase()] || {
    unit: rawUnit || undefined,
    deviceClass: null,
    stateClass: undefined,
  };
  const out = { ...info };
  if (out.unit === "%" && /battery|soc|charge/.test(name)) {
    out.deviceClass = "battery";
  }
  if (/odometer|lifetime/.test(name) && out.deviceClass === "distance") {
    out.stateClass = "total_increasing";
  }
  const numeric = value !== undefined && value !== "" && !Number.isNaN(Number(value));
  if (!numeric) {
    // Text sensors can't have state/device classes tied to numbers
    out.stateClass = undefined;
    out.deviceClass = null;
    out.unit = undefined;
  }
  return out;
}

export class Discovery {
  constructor({ discoveryPrefix, topicPrefix, vin, vehicleName }) {
    this.discoveryPrefix = discoveryPrefix;
    this.base = `${topicPrefix}/${vin}`;
    this.nodeId = `onstar2ha_${vin.toLowerCase()}`;
    this.device = {
      identifiers: [vin],
      name: vehicleName,
      manufacturer: "Chevrolet",
      model: "Blazer EV",
      serial_number: vin,
    };
    this.availabilityTopic = `${this.base}/available`;
  }

  configTopic(component, objectId) {
    return `${this.discoveryPrefix}/${component}/${this.nodeId}/${objectId}/config`;
  }

  common(objectId) {
    return {
      unique_id: `${this.nodeId}_${objectId}`,
      availability_topic: this.availabilityTopic,
      device: this.device,
    };
  }

  // A sensor derived from an OnStar diagnostic element.
  diagnosticSensor(groupName, element) {
    const objectId = slugify(element.name);
    const { unit, deviceClass, stateClass } = classify(
      element.name,
      element.unit,
      element.value,
    );
    const payload = {
      ...this.common(objectId),
      name: titleCase(element.displayName || element.name),
      state_topic: `${this.base}/sensor/${objectId}/state`,
      json_attributes_topic: `${this.base}/sensor/${objectId}/attributes`,
    };
    if (unit) payload.unit_of_measurement = unit;
    if (deviceClass) payload.device_class = deviceClass;
    if (stateClass) payload.state_class = stateClass;
    return { topic: this.configTopic("sensor", objectId), payload, objectId };
  }

  deviceTracker() {
    const objectId = "location";
    return {
      topic: this.configTopic("device_tracker", objectId),
      payload: {
        ...this.common(objectId),
        name: "Location",
        state_topic: `${this.base}/device_tracker/state`,
        json_attributes_topic: `${this.base}/device_tracker/attributes`,
        source_type: "gps",
        payload_home: "home",
        payload_not_home: "not_home",
        icon: "mdi:car-electric",
      },
    };
  }

  lock() {
    const objectId = "doors";
    return {
      topic: this.configTopic("lock", objectId),
      payload: {
        ...this.common(objectId),
        name: "Doors",
        command_topic: `${this.base}/lock/set`,
        state_topic: `${this.base}/lock/state`,
        payload_lock: "LOCK",
        payload_unlock: "UNLOCK",
        optimistic: false,
      },
    };
  }

  button(objectId, name, commandPayload, icon) {
    return {
      topic: this.configTopic("button", objectId),
      payload: {
        ...this.common(objectId),
        name,
        command_topic: `${this.base}/command`,
        payload_press: commandPayload,
        icon,
      },
    };
  }

  chargeTargetNumber() {
    const objectId = "charge_target";
    return {
      topic: this.configTopic("number", objectId),
      payload: {
        ...this.common(objectId),
        name: "Target Charge Level",
        command_topic: `${this.base}/charge_target/set`,
        state_topic: `${this.base}/charge_target/state`,
        min: 40,
        max: 100,
        step: 5,
        unit_of_measurement: "%",
        icon: "mdi:battery-charging-80",
      },
    };
  }

  evMetricsSensor() {
    const objectId = "ev_charging_metrics";
    return {
      topic: this.configTopic("sensor", objectId),
      payload: {
        ...this.common(objectId),
        name: "EV Charging Metrics Updated",
        state_topic: `${this.base}/ev/state`,
        json_attributes_topic: `${this.base}/ev/attributes`,
        device_class: "timestamp",
        icon: "mdi:ev-station",
      },
    };
  }

  lastPollSensor() {
    const objectId = "last_poll";
    return {
      topic: this.configTopic("sensor", objectId),
      payload: {
        ...this.common(objectId),
        name: "Last Poll",
        state_topic: `${this.base}/last_poll/state`,
        device_class: "timestamp",
        entity_category: "diagnostic",
        icon: "mdi:clock-check-outline",
      },
    };
  }

  pollStatusSensor() {
    const objectId = "poll_status";
    return {
      topic: this.configTopic("sensor", objectId),
      payload: {
        ...this.common(objectId),
        name: "Poll Status",
        state_topic: `${this.base}/poll_status/state`,
        entity_category: "diagnostic",
        icon: "mdi:sync",
      },
    };
  }
}

function titleCase(text) {
  return String(text)
    .toLowerCase()
    .split(/[\s_]+/)
    .map((w) => (w === "ev" ? "EV" : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}
