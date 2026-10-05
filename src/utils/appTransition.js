import { cloneValue } from "./cloneValue.js";

export const APP_PATHS = Object.freeze(["/", "/browse", "/settings"]);

export const SETTINGS_SECTION_LABELS = Object.freeze({
  visitorDisplay: "Visitor display",
  wifi: "Wi-Fi",
  discogs: "Discogs",
});

export const SETTINGS_SECTIONS = Object.freeze([
  "visitorDisplay",
  "wifi",
  "discogs",
]);
export const VISITOR_HANDOFF_STEPS = Object.freeze([
  "loading",
  "connecting",
  "wifi",
  "collection",
]);

const SETTINGS_HASHES = Object.freeze({
  discogs: "#discogs",
});

const DEFAULT_VISITOR_DISPLAY = Object.freeze({
  idleTimeoutMinutes: 3,
});

const RESUMABLE_PENDING_INTENTS = new Set([
  "settings-save",
  "settings-remove",
  "records-save",
  "genre-options-save",
]);

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function hasSettingsDraftChanges(section) {
  return (
    section?.draft !== null &&
    section?.draft !== undefined &&
    !equal(section.draft, section.saved)
  );
}

export function canDiscardSettingsSection(section) {
  return section?.status !== "saving" && hasSettingsDraftChanges(section);
}

function sectionState(saved = null, draft = saved) {
  return {
    saved: cloneValue(saved),
    draft: cloneValue(draft),
    status: "clean",
    error: null,
    message: null,
  };
}

function emptySettings() {
  return {
    activeSection: "visitorDisplay",
    loaded: false,
    loading: false,
    loadError: null,
    navigationPrompt: null,
    sections: {
      visitorDisplay: sectionState(
        cloneValue(DEFAULT_VISITOR_DISPLAY),
        cloneValue(DEFAULT_VISITOR_DISPLAY),
      ),
      wifi: sectionState(null, null),
      discogs: sectionState(null, null),
    },
  };
}

function clearAdministrator(administrator) {
  return {
    ...administrator,
    authenticated: false,
    editMode: false,
    challenge: {
      open: false,
      message: null,
      error: null,
    },
    pendingIntent: null,
  };
}

function publicReset(state, path = "/") {
  return {
    ...state,
    navigation: {
      ...state.navigation,
      path,
      hash: "",
      returnPath: null,
      returnIntent: null,
    },
    administrator: clearAdministrator(state.administrator),
    visitor: {
      ...state.visitor,
      handoffStep: null,
      displayMode: false,
    },
    settings: {
      ...emptySettings(),
      activeSection: state.settings.activeSection,
    },
  };
}

export function isVisitorTimerActive(state) {
  return (
    state?.navigation?.path === "/" &&
    Boolean(state.visitor?.displayMode || state.visitor?.handoffStep)
  );
}

function dirtySections(settings) {
  return SETTINGS_SECTIONS.filter((section) => {
    return hasSettingsDraftChanges(settings.sections[section]);
  });
}

function settingsWithDraft(settings, section, draft) {
  const current = settings.sections[section];
  if (!current || current.status === "saving") return settings;
  const nextStatus =
    draft !== null && draft !== undefined && !equal(draft, current.saved)
      ? "dirty"
      : "clean";
  return {
    ...settings,
    sections: {
      ...settings.sections,
      [section]: {
        ...current,
        draft: cloneValue(draft),
        status: nextStatus,
        error: null,
        message: null,
      },
    },
  };
}

function sectionForHash(hash) {
  return hash === SETTINGS_HASHES.discogs ? "discogs" : "visitorDisplay";
}

function hashForSection(section) {
  return SETTINGS_HASHES[section] ?? "";
}

export function normalizeHash(hash) {
  return hash === SETTINGS_HASHES.discogs ? hash : "";
}

function applyPath(
  state,
  path,
  returnPath = state.navigation.returnPath,
  hash = state.navigation.hash,
  returnIntent = state.navigation.returnIntent,
) {
  if (path === "/") return publicReset(state, path);
  const normalizedHash = path === "/settings" ? normalizeHash(hash) : "";
  return {
    ...state,
    navigation: {
      ...state.navigation,
      path,
      hash: normalizedHash,
      returnPath: path === "/settings" ? returnPath : null,
      returnIntent: path === "/settings" ? returnIntent : null,
    },
    settings: {
      ...state.settings,
      navigationPrompt: null,
      activeSection:
        path === "/settings"
          ? sectionForHash(normalizedHash)
          : state.settings.activeSection,
    },
    visitor: {
      ...state.visitor,
      handoffStep: null,
      displayMode: false,
    },
  };
}

function preservesSettingsOrigin(returnIntent) {
  return (
    returnIntent?.type === "sync" ||
    returnIntent?.type === "collection-display"
  );
}

function returnFromSettings(state, path, returnIntent) {
  if (!preservesSettingsOrigin(returnIntent)) {
    return applyPath(state, path);
  }

  return {
    ...state,
    administrator: state.administrator.challenge.open
      ? {
          ...state.administrator,
          challenge: {
            open: false,
            message: null,
            error: null,
          },
          pendingIntent: null,
        }
      : state.administrator,
    navigation: {
      ...state.navigation,
      path,
      hash: "",
      returnPath: null,
      returnIntent: null,
    },
    visitor: {
      ...state.visitor,
      handoffStep: null,
      displayMode:
        path === "/" ? Boolean(returnIntent.displayMode) : false,
    },
    settings: {
      ...emptySettings(),
      activeSection: state.settings.activeSection,
    },
  };
}

function requestNavigation(
  state,
  path,
  { hash = "", returnIntent: requestedReturnIntent = null } = {},
) {
  const normalizedPath = normalizePath(path);
  const normalizedHash =
    normalizedPath === "/settings" ? normalizeHash(hash) : "";
  if (
    normalizedPath === state.navigation.path &&
    normalizedHash === state.navigation.hash
  ) {
    return state;
  }

  if (state.navigation.path === "/settings" && isSettingsSaving(state)) {
    return state;
  }

  const dirty = dirtySections(state.settings);
  if (state.navigation.path === "/settings" && dirty.length > 0) {
    const navigationPrompt = {
      path: normalizedPath,
      sections: dirty.map((section) => SETTINGS_SECTION_LABELS[section]),
    };
    if (normalizedPath === "/settings") {
      navigationPrompt.hash = normalizedHash;
    }
    return {
      ...state,
      settings: {
        ...state.settings,
        navigationPrompt,
      },
    };
  }

  if (normalizedPath === "/settings") {
    const returnPath =
      state.navigation.path === "/settings"
        ? state.navigation.returnPath
        : state.navigation.path;
    const returnIntent =
      state.navigation.path === "/settings"
        ? state.navigation.returnIntent
        : cloneValue(requestedReturnIntent);
    const next = applyPath(
      state,
      normalizedPath,
      returnPath,
      normalizedHash,
      returnIntent,
    );
    if (next.administrator.authenticated) return next;
    return {
      ...next,
      administrator: {
        ...next.administrator,
        challenge: {
          open: true,
          message: "Sign in to open Settings",
          error: null,
        },
        pendingIntent: { type: "settings" },
      },
    };
  }

  if (
    state.navigation.path === "/settings" &&
    preservesSettingsOrigin(state.navigation.returnIntent) &&
    normalizedPath === state.navigation.returnPath
  ) {
    return returnFromSettings(
      state,
      normalizedPath,
      state.navigation.returnIntent,
    );
  }

  return applyPath(state, normalizedPath);
}

function normalizeSettings(settings) {
  const visitorDisplay = settings?.visitorDisplay ?? DEFAULT_VISITOR_DISPLAY;
  const wifi = settings?.wifi ?? null;
  const discogs = settings?.discogs ?? {
    username: "",
    hasToken: false,
    source: "none",
    canEdit: true,
  };
  return {
    visitorDisplay: sectionState(visitorDisplay),
    wifi: sectionState(wifi),
    discogs: sectionState({
      username: discogs.username ?? "",
      hasToken: Boolean(discogs.hasToken),
      source: discogs.source ?? "none",
      canEdit: Boolean(discogs.canEdit),
      token: "",
    }),
  };
}

export function normalizePath(pathname) {
  const path = typeof pathname === "string" ? pathname.split("?")[0] : "/";
  return APP_PATHS.includes(path) ? path : "/";
}

export function createClientState(pathname = "/", hash = "") {
  const path = normalizePath(pathname);
  const normalizedHash = path === "/settings" ? normalizeHash(hash) : "";
  return {
    navigation: {
      path,
      hash: normalizedHash,
      returnPath: null,
      returnIntent: null,
    },
    visitor: {
      handoffStep: null,
      displayMode: false,
    },
    administrator: {
      configured: null,
      authenticated: false,
      editMode: false,
      challenge: {
        open: false,
        message: null,
        error: null,
      },
      pendingIntent: null,
    },
    settings: {
      ...emptySettings(),
      activeSection: sectionForHash(normalizedHash),
    },
  };
}

export function transition(state, action) {
  switch (action?.type) {
    case "auth-status": {
      const authenticated = Boolean(action.authenticated);
      const next = {
        ...state,
        administrator: {
          ...state.administrator,
          configured:
            typeof action.configured === "boolean"
              ? action.configured
              : state.administrator.configured,
          authenticated,
          editMode: authenticated
            ? state.administrator.editMode
            : false,
        },
      };
      if (state.navigation.path === "/settings" && !authenticated) {
        return {
          ...next,
          administrator: {
            ...next.administrator,
            editMode: false,
            challenge: {
              open: true,
              message: "Sign in to open Settings",
              error: null,
            },
            pendingIntent: { type: "settings" },
          },
        };
      }
      return next;
    }

    case "request-sign-in":
      return {
        ...state,
        administrator: {
          ...state.administrator,
          challenge: {
            open: true,
            message: action.message ?? "Sign in",
            error: null,
          },
          pendingIntent: cloneValue(action.intent ?? { type: "generic" }),
        },
      };

    case "sign-in-failed":
      return {
        ...state,
        administrator: {
          ...state.administrator,
          challenge: {
            ...state.administrator.challenge,
            open: true,
            error: action.error ?? "Unable to sign in.",
          },
        },
      };

    case "sign-in-succeeded": {
      const intent = state.administrator.pendingIntent;
      const retainsPendingAction = RESUMABLE_PENDING_INTENTS.has(intent?.type);
      let next = {
        ...state,
        administrator: {
          ...state.administrator,
          authenticated: true,
          challenge: {
            open: false,
            message: null,
            error: null,
          },
          pendingIntent: retainsPendingAction ? intent : null,
          editMode:
            intent?.type === "edit-mode"
              ? true
              : intent?.type === "generic" || intent?.type === "settings"
                ? false
              : state.administrator.editMode,
        },
        settings:
          intent?.type === "settings"
            ? {
                ...state.settings,
                loadError: null,
              }
            : state.settings,
      };
      if (intent?.type === "settings" && next.navigation.path !== "/settings") {
        next = applyPath(
          next,
          "/settings",
          next.navigation.returnPath,
          next.navigation.hash,
          next.navigation.returnIntent,
        );
      }
      return next;
    }

    case "cancel-sign-in": {
      const settingsIntent =
        state.navigation.path === "/settings" &&
        state.administrator.pendingIntent?.type === "settings";
      if (settingsIntent) {
        if (preservesSettingsOrigin(state.navigation.returnIntent)) {
          return returnFromSettings(
            state,
            state.navigation.returnPath ?? "/browse",
            state.navigation.returnIntent,
          );
        }
        return publicReset(state, state.navigation.returnPath ?? "/browse");
      }
      return {
        ...state,
        administrator: {
          ...state.administrator,
          challenge: {
            open: false,
            message: null,
            error: null,
          },
          pendingIntent: null,
        },
      };
    }

    case "session-expired": {
      const settledSections = Object.fromEntries(
        SETTINGS_SECTIONS.map((section) => {
          const current = state.settings.sections[section];
          if (current?.status !== "saving") return [section, current];
          return [
            section,
            {
              ...current,
              status: hasSettingsDraftChanges(current) ? "dirty" : "clean",
              error: null,
              message: null,
            },
          ];
        }),
      );
      return {
        ...state,
        administrator: {
          ...state.administrator,
          authenticated: false,
          editMode: false,
          challenge: {
            open: true,
            message:
              action.message ??
              (action.action?.type === "settings-save" ||
              action.action?.type === "settings-remove" ||
              action.action?.type === "records-save" ||
              action.action?.type === "genre-options-save"
                ? "Sign in again to finish saving"
                : "Sign in again to continue"),
            error: action.error ?? null,
          },
          pendingIntent: cloneValue(action.action ?? null),
        },
        settings: {
          ...state.settings,
          loading: false,
          sections: settledSections,
        },
      };
    }

    case "consume-pending-intent":
      return {
        ...state,
        administrator: {
          ...state.administrator,
          pendingIntent: null,
        },
      };

    case "request-navigation":
      return requestNavigation(state, action.path, {
        hash: action.hash,
        returnIntent: action.returnIntent,
      });

    case "location-changed":
      return requestNavigation(state, action.path, {
        hash: action.hash,
      });

    case "discard-and-leave": {
      if (isSettingsSaving(state)) return state;
      const path = state.settings.navigationPrompt?.path;
      if (!path) return state;
      const resetSections = Object.fromEntries(
        SETTINGS_SECTIONS.map((section) => {
          const current = state.settings.sections[section];
          return [
            section,
            {
              ...current,
              draft: cloneValue(current.saved),
              status: "clean",
              error: null,
              message: null,
            },
          ];
        }),
      );
      const resetState = {
        ...state,
        settings: {
          ...state.settings,
          sections: resetSections,
          navigationPrompt: null,
        },
      };
      if (path === "/settings") {
        return applyPath(
          resetState,
          path,
          state.navigation.returnPath,
          state.settings.navigationPrompt.hash,
          state.navigation.returnIntent,
        );
      }
      return returnFromSettings(
        resetState,
        path,
        state.navigation.returnIntent,
      );
    }

    case "keep-editing":
      return {
        ...state,
        settings: {
          ...state.settings,
          navigationPrompt: null,
        },
      };

    case "cancel-settings": {
      if (isSettingsSaving(state)) return state;
      const dirty = dirtySections(state.settings);
      if (dirty.length > 0) {
        return {
          ...state,
          settings: {
            ...state.settings,
            navigationPrompt: {
              path: state.navigation.returnPath ?? "/browse",
              sections: dirty.map((section) => SETTINGS_SECTION_LABELS[section]),
            },
          },
        };
      }
      return returnFromSettings(
        state,
        state.navigation.returnPath ?? "/browse",
        state.navigation.returnIntent,
      );
    }

    case "sign-out":
      return {
        ...state,
        administrator: clearAdministrator(state.administrator),
      };

    case "home-selected":
      return publicReset(state, "/");

    case "handoff-open":
      if (state.navigation.path !== "/" || state.visitor.displayMode) {
        return state;
      }
      return {
        ...state,
        visitor: {
          ...state.visitor,
          handoffStep: VISITOR_HANDOFF_STEPS.includes(action.step)
            ? action.step
            : "loading",
        },
      };

    case "handoff-step":
      if (
        state.navigation.path !== "/" ||
        state.visitor.displayMode ||
        !VISITOR_HANDOFF_STEPS.includes(action.step)
      ) {
        return state;
      }
      return {
        ...state,
        visitor: {
          ...state.visitor,
          handoffStep: action.step,
        },
      };

    case "handoff-close":
      return {
        ...state,
        visitor: {
          ...state.visitor,
          handoffStep: null,
        },
      };

    case "visitor-timeout":
      return isVisitorTimerActive(state) ? publicReset(state, "/") : state;

    case "enter-display":
      return state.navigation.path === "/"
        ? {
            ...state,
            visitor: {
              ...state.visitor,
              handoffStep: null,
              displayMode: true,
            },
          }
        : state;

    case "exit-display":
      return state.visitor.displayMode
        ? publicReset(state, "/")
        : state;

    case "edit-mode-enabled":
      if (!state.administrator.authenticated) {
        return transition(state, {
          type: "request-sign-in",
          intent: { type: "edit-mode" },
          message: "Sign in to enable Edit Mode",
        });
      }
      return {
        ...state,
        administrator: {
          ...state.administrator,
          editMode: true,
        },
      };

    case "edit-mode-disabled":
      return {
        ...state,
        administrator: {
          ...state.administrator,
          editMode: false,
        },
      };

    case "settings-loading":
      return {
        ...state,
        settings: {
          ...state.settings,
          loading: true,
          loadError: null,
        },
      };

    case "settings-retry":
      return {
        ...state,
        settings: {
          ...state.settings,
          loaded: false,
          loading: false,
          loadError: null,
        },
      };

    case "settings-loaded": {
      const normalized = normalizeSettings(action.settings);
      return {
        ...state,
        settings: {
          ...state.settings,
          loaded: true,
          loading: false,
          loadError: null,
          sections: normalized,
        },
      };
    }

    case "settings-load-failed":
      return {
        ...state,
        settings: {
          ...state.settings,
          loaded: false,
          loading: false,
          loadError: action.error ?? "Unable to load Settings.",
        },
      };

    case "settings-select-section":
      return SETTINGS_SECTIONS.includes(action.section) &&
        !isSettingsSaving(state)
        ? {
            ...state,
            navigation: {
              ...state.navigation,
              hash: hashForSection(action.section),
            },
            settings: {
              ...state.settings,
              activeSection: action.section,
            },
          }
        : state;

    case "settings-draft-changed":
      return {
        ...state,
        settings: settingsWithDraft(
          state.settings,
          action.section,
          action.draft,
        ),
      };

    case "settings-save-started": {
      const current = state.settings.sections[action.section];
      if (!current || current.status === "saving") return state;
      return {
        ...state,
        settings: {
          ...state.settings,
          sections: {
            ...state.settings.sections,
            [action.section]: {
              ...current,
              status: "saving",
              error: null,
              message: null,
            },
          },
        },
      };
    }

    case "settings-remove-started": {
      const current = state.settings.sections[action.section];
      if (!current || current.status === "saving") return state;
      return {
        ...state,
        settings: {
          ...state.settings,
          sections: {
            ...state.settings.sections,
            [action.section]: {
              ...current,
              status: "saving",
              error: null,
              message: null,
            },
          },
        },
      };
    }

    case "settings-save-succeeded": {
      const current = state.settings.sections[action.section];
      if (!current || current.status !== "saving") return state;
      const saved = cloneValue(action.saved ?? current.draft);
      return {
        ...state,
        settings: {
          ...state.settings,
          sections: {
            ...state.settings.sections,
            [action.section]: {
              ...current,
              saved,
              draft: cloneValue(saved),
              status: "success",
              error: null,
              message: action.message ?? "Saved",
            },
          },
        },
      };
    }

    case "settings-save-failed": {
      const current = state.settings.sections[action.section];
      if (!current || current.status !== "saving") return state;
      return {
        ...state,
        settings: {
          ...state.settings,
          sections: {
            ...state.settings.sections,
            [action.section]: {
              ...current,
              status: action.validation ? "validation-error" : "server-error",
              error: action.error ?? "Unable to save.",
              message: null,
            },
          },
        },
      };
    }

    case "settings-remove-succeeded": {
      const current = state.settings.sections[action.section];
      if (!current || current.status !== "saving") return state;
      return {
        ...state,
        settings: {
          ...state.settings,
          sections: {
            ...state.settings.sections,
            [action.section]: sectionState(null, null),
          },
        },
      };
    }

    default:
      return state;
  }
}

export function isSettingsDirty(state) {
  return dirtySections(state.settings).length > 0;
}

export function isSettingsSaving(state) {
  return SETTINGS_SECTIONS.some(
    (section) => state?.settings?.sections[section]?.status === "saving",
  );
}

export function dirtySettingSections(state) {
  return dirtySections(state.settings).map(
    (section) => SETTINGS_SECTION_LABELS[section],
  );
}
