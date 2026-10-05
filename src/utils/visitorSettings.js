import { normalizeVisitorTimeoutMinutes } from "./visitorTimer.js";

export const VISITOR_SETTINGS_CACHE_TTL_MS = 30_000;

export function isVisitorSettingsCacheFresh(
  loadedAt,
  now = Date.now(),
  ttl = VISITOR_SETTINGS_CACHE_TTL_MS,
) {
  return (
    Number.isFinite(loadedAt) &&
    Number.isFinite(now) &&
    Number.isFinite(ttl) &&
    ttl > 0 &&
    now >= loadedAt &&
    now - loadedAt < ttl
  );
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeVisitorSettings(data) {
  if (
    !isObject(data) ||
    !Number.isInteger(data.idleTimeoutMinutes) ||
    data.idleTimeoutMinutes < 1 ||
    data.idleTimeoutMinutes > 30
  ) {
    throw new Error("Invalid visitor settings response.");
  }

  if (data.wifi === null) {
    return {
      idleTimeoutMinutes: data.idleTimeoutMinutes,
      wifi: null,
    };
  }

  const wifi = data.wifi;
  if (
    !isObject(wifi) ||
    typeof wifi.ssid !== "string" ||
    typeof wifi.password !== "string" ||
    (wifi.security !== "wpa" && wifi.security !== "open") ||
    typeof wifi.hidden !== "boolean" ||
    typeof wifi.qrPayload !== "string"
  ) {
    throw new Error("Invalid visitor settings response.");
  }

  return {
    idleTimeoutMinutes: normalizeVisitorTimeoutMinutes(
      data.idleTimeoutMinutes,
    ),
    wifi: { ...wifi },
  };
}
