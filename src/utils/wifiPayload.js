const WPA_PASSPHRASE_MIN_LENGTH = 8;
const WPA_PASSPHRASE_MAX_LENGTH = 63;
const WPA_KEY_LENGTH = 64;

export class WifiSettingsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "WifiSettingsValidationError";
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function utf8ByteLength(value) {
  return new TextEncoder().encode(value).length;
}

export function normalizeWifiSettings(value) {
  if (!isObject(value)) {
    throw new WifiSettingsValidationError("wifi must be an object");
  }
  if (value.security !== "wpa" && value.security !== "open") {
    throw new WifiSettingsValidationError(
      'wifi.security must be "wpa" or "open"',
    );
  }
  if (typeof value.ssid !== "string") {
    throw new WifiSettingsValidationError("wifi.ssid must be a string");
  }
  const ssidBytes = utf8ByteLength(value.ssid);
  if (ssidBytes < 1 || ssidBytes > 32) {
    throw new WifiSettingsValidationError(
      "wifi.ssid must be between 1 and 32 UTF-8 bytes",
    );
  }
  if (typeof value.password !== "string") {
    throw new WifiSettingsValidationError(
      "wifi.password must be a string",
    );
  }
  if (typeof value.hidden !== "boolean") {
    throw new WifiSettingsValidationError("wifi.hidden must be a boolean");
  }

  if (value.security === "open" && value.password !== "") {
    throw new WifiSettingsValidationError(
      "wifi.password must be empty for an open network",
    );
  }

  if (value.security === "wpa") {
    const passwordLength = Array.from(value.password).length;
    const isHexKey =
      value.password.length === WPA_KEY_LENGTH &&
      /^[0-9a-fA-F]{64}$/.test(value.password);
    const isPassphrase =
      passwordLength >= WPA_PASSPHRASE_MIN_LENGTH &&
      passwordLength <= WPA_PASSPHRASE_MAX_LENGTH;
    if (!isHexKey && !isPassphrase) {
      throw new WifiSettingsValidationError(
        "wifi.password must be an 8-63 character passphrase or a 64-character hexadecimal key",
      );
    }
  }

  return { ...value };
}

function escapeWifiField(value) {
  return String(value).replace(/[\\;,:"]/g, "\\$&");
}

export function buildWifiQrPayload(settings) {
  const { security, ssid, password, hidden } = normalizeWifiSettings(settings);
  const type = security === "open" ? "nopass" : "WPA";
  return (
    `WIFI:T:${type};S:${escapeWifiField(ssid)};` +
    `P:${escapeWifiField(password)};H:${hidden};;`
  );
}
