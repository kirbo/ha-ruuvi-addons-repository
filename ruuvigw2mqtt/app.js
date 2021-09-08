const ruuviParser = require("./ruuvi/parser");
const dc = require("./device_config");
const mqtt = require("mqtt");

const options = require("/data/options.json");

const timeBetweenData = options.update_interval * 1000; // ms
const lastSent = {};
const mqttOpts = {
  clientId:
    options.mqtt_credentials.client_id ||
    "ruuvi-gw-mqtt-to-ha_" + Math.random().toString(16).substr(2, 8),
  username: options.mqtt_credentials.username,
  username: options.mqtt_credentials.password,
};

const client = mqtt.connect(
  `${options.mqtt_address}://${options.mqtt_address}:${options.mqtt_port}`,
  mqttOpts
);

client.on("connect", () => {
  console.log("mqtt connected");
  client.subscribe(options.mqtt_ruuvi_topic);
});

client.on("close", () => {
  console.log("mqtt disconnected");
});

client.on("error", (error) => {
  console.error(`mqtt error ${error}`);
});

client.on("message", (topic, message) => {
  const payload = JSON.parse(message.toString());
  if (payload?.data) {
    const mac = /[^/]*$/.exec(topic)[0];
    handleData(payload, mac);
  } else {
    console.log(topic, message.toString());
  }
});

const send = (id, payload) => {
  console.log(`${options.mqtt_ha_topic}${id}`, JSON.stringify(payload));
  client.publish(`${options.mqtt_ha_topic}${id}`, JSON.stringify(payload));
};

const sendConfig = (id, type, payload) => {
  console.log(
    `${options.mqtt_ha_topic}sensor/${id}/${type}/config`,
    JSON.stringify(payload)
  );

  client.publish(
    `${options.mqtt_ha_topic}sensor/${id}/${type}/config`,
    JSON.stringify(payload),
    { retain: true }
  );
};

const handleData = (sr, mac) => {
  mac = mac.split(":").join("");

  // if (sr.data.indexOf("FF9904") !== -1) {
  if (sr.data.startsWith("FF9904")) {
    // ruuvitag
    const adv = Buffer.from(sr.data.split("FF9904")[1], "hex");
    const dataFormat = adv[0];
    const {
      humidity,
      temperature,
      pressure,
      accelerationX,
      accelerationY,
      accelerationZ,
      battery: voltage,
    } = ruuviParser(sr.data);
    const ruuvitag = {
      dataFormat: dataFormat,
      rssi: sr.rssi,
      humidity,
      temperature,
      pressure,
      accelerationX,
      accelerationY,
      accelerationZ,
      voltage,
    };

    updated(mac, "RuuviTag", ruuvitag);
    return;
  }

  // if (sr.data.indexOf("02010603029") !== -1) {
  if (sr.data.startsWith("02010603029")) {
    // mi flora
    const data = hexToBytes(sr.data);
    const dataType = data[23];
    const out = {};
    switch (dataType) {
      case 7: // LIGHT
        out.light = parseInt(
          intToHex(data[data.length - 1]) +
            intToHex(data[data.length - 2]) +
            intToHex(data[data.length - 3]),
          16
        );
        break;
      case 9: // COND
        out.conductivity = parseInt(
          intToHex(data[data.length - 1]) + intToHex(data[data.length - 2]),
          16
        );
        break;
      case 8: // MOISTURE
        out.moisture = data[data.length - 1];
        break;
      case 4: // TEMP
        out.temperature =
          parseInt(
            intToHex(data[data.length - 1]) + intToHex(data[data.length - 2]),
            16
          ) / 10.0;
        break;
      default:
        console.log("Flower unknown dataType", dataType);
        return;
    }
    out.rssi = sr.rssi;
    updated(mac, "Flower care", out);
    return;
  }

  // if (sr.data.indexOf("10161A18A4C") !== -1) {
  if (sr.data.startsWith("10161A18A4C")) {
    // flashed ATC
    const data = hexToBytes(sr.data);
    const out = {};
    out.temperature =
      parseInt(intToHex(data[10]) + intToHex(data[11]), 16) / 10.0;
    out.humidity = parseInt(intToHex(data[12]), 16);
    out.battery = parseInt(intToHex(data[13]), 16);
    out.voltage =
      parseInt(intToHex(data[14]) + intToHex(data[15]), 16) / 1000.0;
    out.rssi = sr.rssi;
    updated(mac, "ACT_MI_TEMP", out);
    return;
  }

  // if (sr.data.indexOf("020106151695FE") !== -1) {
  if (sr.data.startsWith("020106151695FE")) {
    // xiaomi round temperature & humidity sensor
    const data = hexToBytes(sr.data);
    const dataType = data[18];
    const out = {};
    switch (dataType) {
      case 13: // temp and humidity
        out.humidity =
          parseInt(
            intToHex(data[data.length - 1]) + intToHex(data[data.length - 2]),
            16
          ) / 10.0;
        out.temperature =
          parseInt(
            intToHex(data[data.length - 3]) + intToHex(data[data.length - 4]),
            16
          ) / 10.0;
        break;
      case 10: // battery
        out.battery = data[data.length - 1];
        break;
      case 6: // humidity
        out.humidity =
          parseInt(
            intToHex(data[data.length - 1]) + intToHex(data[data.length - 2]),
            16
          ) / 10.0;
        break;
      case 4: // temp
        out.temperature =
          parseInt(
            intToHex(data[data.length - 1]) + intToHex(data[data.length - 2]),
            16
          ) / 10.0;
        break;
      default:
        console.log("MiTemp unknown dataType", dataType);
        return;
    }
    out.rssi = sr.rssi;
    updated(mac, "MJ_HT_V1", out);
    return;
  }
};

const things = {};

const handleTempereture = (id, type) => {
  if (type === "MJ_HT_V1") {
    sendConfig(id, "temperature", dc.miTemp.tempConfig(id));
  } else if (type === "Flower care") {
    sendConfig(id, "temperature", dc.miPlant.tempConfig(id));
  } else if (type === "RuuviTag") {
    sendConfig(id, "temperature", dc.ruuviTag.tempConfig(id));
  } else if (type === "ACT_MI_TEMP") {
    sendConfig(id, "temperature", dc.miTemp2.tempConfig(id));
  }
};

const handleRssi = (id, type) => {
  if (type === "MJ_HT_V1") {
    sendConfig(id, "rssi", dc.miTemp.rssiConfig(id));
  } else if (type === "Flower care") {
    sendConfig(id, "rssi", dc.miPlant.rssiConfig(id));
  } else if (type === "RuuviTag") {
    sendConfig(id, "rssi", dc.ruuviTag.rssiConfig(id));
  } else if (type === "ACT_MI_TEMP") {
    sendConfig(id, "rssi", dc.miTemp2.rssiConfig(id));
  }
};

const handleHumidity = (id, type) => {
  if (type === "MJ_HT_V1") {
    sendConfig(id, "humidity", dc.miTemp.humidityConfig(id));
  } else if (type === "RuuviTag") {
    sendConfig(id, "humidity", dc.ruuviTag.humidityConfig(id));
  } else if (type === "ACT_MI_TEMP") {
    sendConfig(id, "humidity", dc.miTemp2.humidityConfig(id));
  }
};

const handleVoltage = (id, type) => {
  if (type === "RuuviTag") {
    sendConfig(id, "voltage", dc.ruuviTag.voltageConfig(id));
  } else if (type === "ACT_MI_TEMP") {
    sendConfig(id, "voltage", dc.miTemp2.voltageConfig(id));
  }
};

const handlePressure = (id, type) => {
  if (type === "RuuviTag") {
    sendConfig(id, "pressure", dc.ruuviTag.pressureConfig(id));
  }
};

const handleTxPower = (id, type) => {
  if (type === "RuuviTag") {
    sendConfig(id, "txPower", dc.ruuviTag.txPowerConfig(id));
  }
};

const handleAccelerationX = (id, type) => {
  if (type === "RuuviTag") {
    sendConfig(id, "accelerationX", dc.ruuviTag.accelerationXConfig(id));
  }
};

const handleAccelerationY = (id, type) => {
  if (type === "RuuviTag") {
    sendConfig(id, "accelerationY", dc.ruuviTag.accelerationYConfig(id));
  }
};

const handleAccelerationZ = (id, type) => {
  if (type === "RuuviTag") {
    sendConfig(id, "accelerationZ", dc.ruuviTag.accelerationZConfig(id));
  }
};

const handleMovementCounter = (id, type) => {
  if (type === "RuuviTag") {
    sendConfig(id, "movementCounter", dc.ruuviTag.movementCounterConfig(id));
  }
};

const handleMeasurementSequenceNumber = (id, type) => {
  if (type === "RuuviTag") {
    sendConfig(
      id,
      "measurementSequenceNumber",
      dc.ruuviTag.measurementSequenceNumberConfig(id)
    );
  }
};

const handleDataFormat = (id, type) => {
  if (type === "RuuviTag") {
    sendConfig(id, "dataFormat", dc.ruuviTag.dataFormatConfig(id));
  }
};

const handleBattery = (id, type) => {
  if (type === "MJ_HT_V1") {
    sendConfig(id, "battery", dc.miTemp.batteryConfig(id));
  } else if (type === "ACT_MI_TEMP") {
    sendConfig(id, "battery", dc.miTemp2.batteryConfig(id));
  }
};

const handleLight = (id, type) => {
  if (type === "Flower care") {
    sendConfig(id, "light", dc.miPlant.lightConfig(id));
  }
};

const handleConductivity = (id, type) => {
  if (type === "Flower care") {
    sendConfig(id, "conductivity", dc.miPlant.conductivityConfig(id));
  }
};

const handleMoisture = (id, type) => {
  if (type === "Flower care") {
    sendConfig(id, "moisture", dc.miPlant.moistureConfig(id));
  }
};

const updated = (id, type, data) => {
  for (const key in data) {
    if (things[id] !== undefined && things[id][key] !== undefined) continue;

    switch (key) {
      case "temperature":
        handleTempereture(id, type);
        break;
      case "rssi":
        handleRssi(id, type);
        break;
      case "humidity":
        handleHumidity(id, type);
        break;
      case "voltage":
        handleVoltage(id, type);
        break;
      case "pressure":
        handlePressure(id, type);
        break;
      case "txPower":
        handleTxPower(id, type);
        break;
      case "accelerationX":
        handleAccelerationX(id, type);
        break;
      case "accelerationY":
        handleAccelerationY(id, type);
        break;
      case "accelerationZ":
        handleAccelerationZ(id, type);
        break;
      case "movementCounter":
        handleMovementCounter(id, type);
        break;
      case "measurementSequenceNumber":
        handleMeasurementSequenceNumber(id, type);
        break;
      case "dataFormat":
        handleDataFormat(id, type);
        break;
      case "battery":
        handleBattery(id, type);
        break;
      case "light":
        handleLight(id, type);
        break;
      case "conductivity":
        handleConductivity(id, type);
        break;
      case "moisture":
        handleMoisture(id, type);
        break;
      default:
        console.log(`No handler for ${key}`);
        break;
    }
  }

  things[id] =
    things[id] === undefined ? data : Object.assign(things[id], data);

  if (lastSent[id] !== undefined) {
    if (lastSent[id] + timeBetweenData > new Date().getTime()) return;
  }

  lastSent[id] = new Date().getTime();
  send(id, things[id]);
};

const intToHex = (val) => ("00" + val.toString(16)).slice(-2);

const hexToBytes = (hex) => {
  for (const bytes = [], c = 0; c < hex.length; c += 2) {
    bytes.push(parseInt(hex.substr(c, 2), 16));
  }

  return bytes;
};