import {
  normalizeWifiSettings,
  WifiSettingsValidationError,
} from "../src/utils/wifiPayload.js";

export const SITE_SETTINGS_SCHEMA_VERSION = 1;

export class SiteSettingsValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "SiteSettingsValidationError";
  }
}

export const DEFAULT_SITE_SETTINGS = Object.freeze({
  schemaVersion: SITE_SETTINGS_SCHEMA_VERSION,
  visitorDisplay: Object.freeze({
    idleTimeoutMinutes: 3,
  }),
  wifi: null,
});

export function createDefaultSiteSettings() {
  return {
    schemaVersion: DEFAULT_SITE_SETTINGS.schemaVersion,
    visitorDisplay: {
      idleTimeoutMinutes:
        DEFAULT_SITE_SETTINGS.visitorDisplay.idleTimeoutMinutes,
    },
    wifi: null,
  };
}

export function normalizeSiteSettings(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new SiteSettingsValidationError(
      "document must be an object",
    );
  }
  if (value.schemaVersion !== SITE_SETTINGS_SCHEMA_VERSION) {
    throw new SiteSettingsValidationError(
      `schemaVersion must be ${SITE_SETTINGS_SCHEMA_VERSION}`,
    );
  }
  if (
    value.visitorDisplay === null ||
    typeof value.visitorDisplay !== "object" ||
    Array.isArray(value.visitorDisplay)
  ) {
    throw new SiteSettingsValidationError(
      "visitorDisplay must be an object",
    );
  }

  const { idleTimeoutMinutes } = value.visitorDisplay;
  if (
    !Number.isInteger(idleTimeoutMinutes) ||
    idleTimeoutMinutes < 1 ||
    idleTimeoutMinutes > 30
  ) {
    throw new SiteSettingsValidationError(
      "visitorDisplay.idleTimeoutMinutes must be a whole number from 1 through 30",
    );
  }

  let wifi = null;
  if (value.wifi !== null) {
    try {
      wifi = normalizeWifiSettings(value.wifi);
    } catch (error) {
      if (error instanceof WifiSettingsValidationError) {
        throw new SiteSettingsValidationError(error.message);
      }
      throw error;
    }
  }

  return {
    ...value,
    visitorDisplay: {
      ...value.visitorDisplay,
      idleTimeoutMinutes,
    },
    wifi,
  };
}

export const validateSiteSettings = normalizeSiteSettings;
