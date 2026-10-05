import { useCallback, useEffect, useRef, useState } from "react";
import AddRecordForm from "./components/AddRecordForm";
import DiscogsImport from "./components/DiscogsImport";
import EditRecordModal from "./components/EditRecordModal";
import HomeScreen from "./components/HomeScreen";
import ListeningRoom from "./components/ListeningRoom";
import SettingsPage from "./components/SettingsPage";
import SignInChallenge from "./components/SignInChallenge";
import UpdatePrompt from "./components/UpdatePrompt";
import VisitorHandoffModal from "./components/VisitorHandoffModal";
import { sampleRecords, generateId } from "./data/records.js";
import {
  GENRES as DEFAULT_GENRES,
  SUB_GENRES as DEFAULT_SUB_GENRES,
} from "./data/genreOptions";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  createClientState,
  isSettingsDirty,
  isSettingsSaving,
  normalizePath,
  normalizeHash,
  isVisitorTimerActive,
  transition,
} from "./utils/appTransition.js";
import {
  createVisitorTimer,
  getVisitorTimerSnapshot,
  normalizeVisitorTimeoutMinutes,
  resetVisitorTimer,
} from "./utils/visitorTimer.js";
import { isVisitorActivityEvent } from "./utils/visitorActivity.js";
import {
  isVisitorSettingsCacheFresh,
  normalizeVisitorSettings,
  VISITOR_SETTINGS_CACHE_TTL_MS,
} from "./utils/visitorSettings.js";
import { isAdministratorSessionError } from "./utils/apiErrors.js";
import { createRequestGeneration } from "./utils/requestGeneration.js";
import {
  addGenre,
  addRecord,
  addSubGenre,
  applyDiscogsImport,
  deleteRecord,
  deleteSubGenre,
  editRecord,
  getCollectionWriteSuccessCleanup,
} from "./utils/collectionWrites.js";
import { cloneValue } from "./utils/cloneValue.js";
import "./App.css";

const UPDATE_CHECK_INTERVAL = 15 * 60 * 1000;
const DEFAULT_VISITOR_SETTINGS = Object.freeze({
  idleTimeoutMinutes: 3,
  wifi: null,
});

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(
      body?.error || `Request failed (HTTP ${response.status}).`,
    );
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

function errorMessage(error, fallback = "Unable to complete the request.") {
  return error instanceof Error && error.message ? error.message : fallback;
}

function normalizeDiscogsConfig(data) {
  const validSources = new Set(["environment", "saved", "none"]);
  if (
    !data ||
    typeof data.username !== "string" ||
    typeof data.hasToken !== "boolean" ||
    !validSources.has(data.source) ||
    typeof data.canEdit !== "boolean"
  ) {
    throw new Error("Invalid Discogs credential response.");
  }

  return data;
}

function discogsDraftAfterSave(draft) {
  return {
    ...draft,
    token: "",
    hasToken: true,
    source: "saved",
    canEdit: true,
  };
}

function App() {
  const [clientState, setClientState] = useState(() =>
    createClientState(window.location.pathname, window.location.hash),
  );
  const clientStateRef = useRef(clientState);
  clientStateRef.current = clientState;

  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingRecord, setEditingRecord] = useState(null);
  const [showAddRecord, setShowAddRecord] = useState(false);
  const [genres, setGenres] = useState(DEFAULT_GENRES);
  const [subGenres, setSubGenres] = useState(DEFAULT_SUB_GENRES);
  const [showDiscogsImport, setShowDiscogsImport] = useState(false);
  const [visitorSettings, setVisitorSettings] = useState(
    DEFAULT_VISITOR_SETTINGS,
  );
  const [visitorSettingsError, setVisitorSettingsError] = useState(null);
  const [visitorTimerSnapshot, setVisitorTimerSnapshot] = useState(null);
  const [discogsConfig, setDiscogsConfig] = useState(null);
  const [discogsConfigLoading, setDiscogsConfigLoading] = useState(false);
  const [discogsConfigError, setDiscogsConfigError] = useState(null);
  const [signInSubmitting, setSignInSubmitting] = useState(false);
  const [collectionWriteError, setCollectionWriteError] = useState(null);
  const [adminSessionError, setAdminSessionError] = useState(null);
  const recordsRef = useRef(records);
  const genresRef = useRef(genres);
  const subGenresRef = useRef(subGenres);
  const collectionWriteInFlightRef = useRef(false);
  const visitorSettingsRef = useRef(DEFAULT_VISITOR_SETTINGS);
  const visitorSettingsLoadedRef = useRef(false);
  const visitorSettingsLoadedAtRef = useRef(0);
  const visitorSettingsRequestRef = useRef(null);
  const logoutRequestRef = useRef(null);
  const authGenerationRef = useRef(null);
  const discogsImportGenerationRef = useRef(null);
  const registrationRef = useRef(null);
  if (authGenerationRef.current === null) {
    authGenerationRef.current = createRequestGeneration();
  }
  const authGeneration = authGenerationRef.current;
  const {
    needRefresh: [isUpdateAvailable],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW: (_swUrl, registration) => {
      registrationRef.current = registration ?? null;
    },
  });
  recordsRef.current = records;
  genresRef.current = genres;
  subGenresRef.current = subGenres;

  const transitionClient = useCallback((action, { historyMode = "push" } = {}) => {
    if (
      [
        "cancel-sign-in",
        "exit-display",
        "home-selected",
        "session-expired",
        "sign-out",
        "visitor-timeout",
      ].includes(action?.type)
    ) {
      authGeneration.invalidate();
    }

    const previous = clientStateRef.current;
    const next = transition(previous, action);
    clientStateRef.current = next;
    setClientState(next);

    const previousLocation =
      previous.navigation.path + previous.navigation.hash;
    const nextLocation = next.navigation.path + next.navigation.hash;
    if (nextLocation !== previousLocation) {
      if (historyMode === "replace") {
        window.history.replaceState({}, "", nextLocation);
      } else if (historyMode === "push") {
        window.history.pushState({}, "", nextLocation);
      }
    }

    return next;
  }, [authGeneration]);

  const requestAuthorizedJson = useCallback(
    async (url, options = {}, pendingAction = null) => {
      const requestGeneration = authGeneration.capture();
      try {
        return await requestJson(url, options);
      } catch (error) {
        if (
          authGeneration.isCurrent(requestGeneration) &&
          isAdministratorSessionError(error?.status, error?.body)
        ) {
          transitionClient({
            type: "session-expired",
            action: cloneValue(pendingAction),
          });
        }
        throw error;
      }
    },
    [authGeneration, transitionClient],
  );

  const requestAdminLogout = useCallback(async () => {
    if (!clientStateRef.current.administrator.authenticated) {
      setAdminSessionError(null);
      return true;
    }
    if (!logoutRequestRef.current) {
      setAdminSessionError(null);
      logoutRequestRef.current = requestJson("/api/auth/logout", {
        method: "POST",
      })
        .then(() => true)
        .catch((error) => {
          setAdminSessionError(
            `Unable to sign out: ${errorMessage(
              error,
              "request failed",
            )}. The administrator session is still active.`,
          );
          return false;
        })
        .finally(() => {
          logoutRequestRef.current = null;
        });
    }
    return logoutRequestRef.current;
  }, []);

  const loadVisitorSettings = useCallback((force = false) => {
    if (
      !force &&
      visitorSettingsLoadedRef.current &&
      isVisitorSettingsCacheFresh(
        visitorSettingsLoadedAtRef.current,
        Date.now(),
        VISITOR_SETTINGS_CACHE_TTL_MS,
      )
    ) {
      return Promise.resolve(visitorSettingsRef.current);
    }
    if (visitorSettingsRequestRef.current) {
      return visitorSettingsRequestRef.current;
    }

    const request = requestJson("/api/visitor-settings")
      .then((data) => normalizeVisitorSettings(data))
      .then((settings) => {
        visitorSettingsRef.current = settings;
        visitorSettingsLoadedRef.current = true;
        visitorSettingsLoadedAtRef.current = Date.now();
        setVisitorSettingsError(null);
        setVisitorSettings(settings);
        return settings;
      })
      .catch((error) => {
        visitorSettingsLoadedRef.current = false;
        visitorSettingsLoadedAtRef.current = 0;
        setVisitorSettingsError(
          errorMessage(error, "Unable to load visitor settings."),
        );
        throw error;
      });
    visitorSettingsRequestRef.current = request;
    request.then(
      () => {
        if (visitorSettingsRequestRef.current === request) {
          visitorSettingsRequestRef.current = null;
        }
      },
      () => {
        if (visitorSettingsRequestRef.current === request) {
          visitorSettingsRequestRef.current = null;
        }
      },
    );
    return request;
  }, []);

  const refreshVisitorSettings = useCallback(async () => {
    const inFlight = visitorSettingsRequestRef.current;
    if (inFlight) {
      await inFlight.catch(() => {});
    }
    visitorSettingsLoadedRef.current = false;
    visitorSettingsLoadedAtRef.current = 0;
    return loadVisitorSettings();
  }, [loadVisitorSettings]);

  useEffect(() => {
    loadVisitorSettings().catch(() => {});
  }, [loadVisitorSettings]);

  useEffect(() => {
    const onFocus = () => {
      if (
        !isVisitorSettingsCacheFresh(
          visitorSettingsLoadedAtRef.current,
          Date.now(),
          VISITOR_SETTINGS_CACHE_TTL_MS,
        )
      ) {
        loadVisitorSettings(true).catch(() => {});
      }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [loadVisitorSettings]);

  useEffect(() => {
    if (
      clientState.navigation.path !== "/" ||
      clientState.visitor.displayMode ||
      clientState.visitor.handoffStep
    ) {
      return;
    }
    loadVisitorSettings(true).catch(() => {});
  }, [
    clientState.navigation.path,
    clientState.visitor.displayMode,
    clientState.visitor.handoffStep,
    loadVisitorSettings,
  ]);

  useEffect(() => {
    const normalized = normalizePath(window.location.pathname);
    const normalizedHash = normalizeHash(window.location.hash);
    const normalizedLocation = normalized + normalizedHash;
    if (
      normalized !== window.location.pathname ||
      normalizedHash !== window.location.hash
    ) {
      window.history.replaceState({}, "", normalizedLocation);
    }
  }, []);

  const handlePopState = useCallback(() => {
    const current = clientStateRef.current;
    const target = normalizePath(window.location.pathname);
    const targetHash = normalizeHash(window.location.hash);

    if (
      current.navigation.path === "/" &&
      current.visitor.displayMode
    ) {
      void requestAdminLogout().then((signedOut) => {
        if (!signedOut) return;
        transitionClient(
          { type: "exit-display" },
          { historyMode: "none" },
        );
        setEditingRecord(null);
        setShowAddRecord(false);
        setShowDiscogsImport(false);
        window.history.replaceState({}, "", "/");
      });
      return;
    }

    const next = transition(current, {
      type: "location-changed",
      path: target,
      hash: targetHash,
    });
    if (
      next.navigation.path === current.navigation.path &&
      next.navigation.hash === current.navigation.hash &&
      next.settings.navigationPrompt
    ) {
      window.history.pushState(
        {},
        "",
        current.navigation.path + current.navigation.hash,
      );
      clientStateRef.current = next;
      setClientState(next);
      return;
    }

    const shouldResumeSync =
      current.navigation.path === "/settings" &&
      next.navigation.path !== "/settings" &&
      current.navigation.returnIntent?.type === "sync";
    const nextLocation = next.navigation.path + next.navigation.hash;
    if (
      window.location.pathname + window.location.hash !==
      nextLocation
    ) {
      window.history.replaceState({}, "", nextLocation);
    }
    if (next.navigation.path === "/" && !next.visitor.displayMode) {
      authGeneration.invalidate();
    }
    clientStateRef.current = next;
    setClientState(next);
    if (next.navigation.path === "/settings") {
      setShowDiscogsImport(false);
    }
    if (shouldResumeSync) setShowDiscogsImport(true);
  }, [authGeneration, transitionClient]);

  useEffect(() => {
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [handlePopState]);

  useEffect(() => {
    function warnBeforeLeaving(event) {
      if (
        clientStateRef.current.navigation.path !== "/settings" ||
        (!isSettingsDirty(clientStateRef.current) &&
          !isSettingsSaving(clientStateRef.current))
      ) {
        return;
      }
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [clientState.settings]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const registration = registrationRef.current;
      if (!registration) return;

      registration.update().catch((error) => {
        console.error("Unable to check for a PWA update:", error);
      });
    }, UPDATE_CHECK_INTERVAL);

    return () => window.clearInterval(intervalId);
  }, []);

  function handleReload() {
    updateServiceWorker(true).catch((error) => {
      console.error("Unable to activate the available PWA update:", error);
    });
  }

  const loadDiscogsConfig = useCallback(async () => {
    const requestGeneration = authGeneration.capture();
    setDiscogsConfigLoading(true);
    setDiscogsConfigError(null);
    try {
      const config = normalizeDiscogsConfig(
        await requestAuthorizedJson("/api/discogs-config"),
      );
      if (!authGeneration.isCurrent(requestGeneration)) return null;
      setDiscogsConfig(config);
      return config;
    } catch (error) {
      if (!authGeneration.isCurrent(requestGeneration)) return null;
      const message = errorMessage(
        error,
        "Unable to load Discogs credentials.",
      );
      setDiscogsConfigError(message);
      throw error;
    } finally {
      if (authGeneration.isCurrent(requestGeneration)) {
        setDiscogsConfigLoading(false);
      }
    }
  }, [authGeneration, requestAuthorizedJson]);

  const handleOpenDiscogsSettings = useCallback(() => {
    setShowDiscogsImport(false);
    transitionClient({
      type: "request-navigation",
      path: "/settings",
      hash: "#discogs",
      returnIntent: {
        type: "sync",
        displayMode: clientStateRef.current.visitor.displayMode,
      },
    });
  }, [requestAdminLogout, transitionClient]);

  useEffect(() => {
    if (showDiscogsImport) {
      if (discogsImportGenerationRef.current === null) {
        discogsImportGenerationRef.current = authGeneration.capture();
      }
      return;
    }
    discogsImportGenerationRef.current = null;
  }, [authGeneration, showDiscogsImport]);

  const handleDiscogsSessionExpired = useCallback(() => {
    const importGeneration = discogsImportGenerationRef.current;
    if (
      importGeneration !== null &&
      !authGeneration.isCurrent(importGeneration)
    ) {
      return;
    }
    transitionClient({
      type: "session-expired",
      message: "Sign in again to continue",
      action: null,
    });
  }, [authGeneration, transitionClient]);

  useEffect(() => {
    if (!showDiscogsImport || !clientState.administrator.authenticated) return;
    loadDiscogsConfig().catch(() => {});
  }, [
    clientState.administrator.authenticated,
    loadDiscogsConfig,
    showDiscogsImport,
  ]);

  // Load genre options from server on mount.
  useEffect(() => {
    fetch("/api/genre-options")
      .then((response) => response.json())
      .then((data) => {
        if (data?.genres) setGenres(data.genres);
        if (data?.subGenres) setSubGenres(data.subGenres);
      })
      .catch((error) => {
        console.error("Failed to load genre options:", error);
      });
  }, []);

  // Load records from server on mount.
  useEffect(() => {
    fetch("/api/records")
      .then((response) => response.json())
      .then((data) => {
        setRecords(data.records ?? sampleRecords);
        setLoading(false);
      })
      .catch((error) => {
        console.error("Failed to load records:", error);
        setRecords(sampleRecords);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    let active = true;
    const requestGeneration = authGeneration.capture();
    requestJson("/api/auth/session")
      .then((session) => {
        if (!active || !authGeneration.isCurrent(requestGeneration)) return;
        transitionClient({
          type: "auth-status",
          configured: session.configured,
          authenticated: session.authenticated,
        });
      })
      .catch(() => {
        if (!active || !authGeneration.isCurrent(requestGeneration)) return;
        transitionClient({
          type: "auth-status",
          authenticated: false,
        });
      });
    return () => {
      active = false;
    };
  }, [authGeneration, transitionClient]);

  const loadSettings = useCallback(async () => {
    const requestGeneration = authGeneration.capture();
    transitionClient({ type: "settings-loading" });
    try {
      const [siteSettings, discogs] = await Promise.all([
        requestAuthorizedJson("/api/site-settings", {}, { type: "settings" }),
        requestAuthorizedJson(
          "/api/discogs-config",
          {},
          { type: "settings" },
        ),
      ]);
      if (!authGeneration.isCurrent(requestGeneration)) return;
      transitionClient({
        type: "settings-loaded",
        settings: {
          ...siteSettings,
          discogs,
        },
      });
    } catch (error) {
      if (!authGeneration.isCurrent(requestGeneration)) return;
      transitionClient({
        type: "settings-load-failed",
        error: errorMessage(error, "Unable to load Settings."),
      });
    }
  }, [authGeneration, requestAuthorizedJson, transitionClient]);

  useEffect(() => {
    const settings = clientState.settings;
    if (
      clientState.navigation.path !== "/settings" ||
      !clientState.administrator.authenticated ||
      settings.loaded ||
      settings.loading ||
      settings.loadError
    ) {
      return;
    }
    loadSettings();
  }, [
    clientState.administrator.authenticated,
    clientState.navigation.path,
    clientState.settings,
    loadSettings,
  ]);

  const saveSettingsSection = useCallback(
    async (section, requestedDraft) => {
      const current = clientStateRef.current.settings.sections[section];
      if (!current || current.status === "saving") return;
      const draft = cloneValue(requestedDraft ?? current.draft);
      if (draft === null || draft === undefined) return;
      const requestGeneration = authGeneration.capture();

      const pendingAction = {
        type: "settings-save",
        section,
        draft,
      };
      transitionClient({ type: "settings-save-started", section });
      try {
        if (section === "visitorDisplay") {
          await requestAuthorizedJson(
            "/api/site-settings/visitor-display",
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(draft),
            },
            pendingAction,
          );
        } else if (section === "wifi") {
          await requestAuthorizedJson(
            "/api/site-settings/wifi",
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(draft),
            },
            pendingAction,
          );
        } else {
          await requestAuthorizedJson(
            "/api/discogs-config",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                username: draft.username,
                token: draft.token ?? "",
              }),
            },
            pendingAction,
          );
        }

        if (!authGeneration.isCurrent(requestGeneration)) return;
        if (section === "visitorDisplay" || section === "wifi") {
          await refreshVisitorSettings().catch(() => {});
        }
        if (!authGeneration.isCurrent(requestGeneration)) return;
        const saved =
          section === "discogs" ? discogsDraftAfterSave(draft) : draft;
        transitionClient({
          type: "settings-save-succeeded",
          section,
          saved,
          message: "Saved",
        });
        if (
          clientStateRef.current.administrator.pendingIntent?.type ===
          "settings-save"
        ) {
          transitionClient({ type: "consume-pending-intent" });
        }
      } catch (error) {
        if (
          error?.status === 401 ||
          !authGeneration.isCurrent(requestGeneration)
        ) {
          return;
        }
        transitionClient({
          type: "settings-save-failed",
          section,
          validation: error?.status === 400,
          error: errorMessage(error),
        });
        if (
          clientStateRef.current.administrator.pendingIntent?.type ===
          "settings-save"
        ) {
          transitionClient({ type: "consume-pending-intent" });
        }
      }
    },
    [
      authGeneration,
      refreshVisitorSettings,
      requestAuthorizedJson,
      transitionClient,
    ],
  );

  const removeSettingsSection = useCallback(
    async (section) => {
      const current = clientStateRef.current.settings.sections[section];
      if (!current || current.status === "saving") return;
      if (section !== "wifi" && section !== "discogs") return;
      const requestGeneration = authGeneration.capture();

      transitionClient({ type: "settings-remove-started", section });
      try {
        const url =
          section === "wifi"
            ? "/api/site-settings/wifi"
            : "/api/discogs-config";
        await requestAuthorizedJson(
          url,
          { method: "DELETE" },
          { type: "settings-remove", section },
        );
        if (!authGeneration.isCurrent(requestGeneration)) return;
        if (section === "wifi") {
          await refreshVisitorSettings().catch(() => {});
        }
        if (!authGeneration.isCurrent(requestGeneration)) return;
        transitionClient({
          type: "settings-remove-succeeded",
          section,
        });
        if (
          clientStateRef.current.administrator.pendingIntent?.type ===
          "settings-remove"
        ) {
          transitionClient({ type: "consume-pending-intent" });
        }
      } catch (error) {
        if (
          error?.status === 401 ||
          !authGeneration.isCurrent(requestGeneration)
        ) {
          return;
        }
        transitionClient({
          type: "settings-save-failed",
          section,
          validation: error?.status === 400,
          error: errorMessage(error),
        });
        if (
          clientStateRef.current.administrator.pendingIntent?.type ===
          "settings-remove"
        ) {
          transitionClient({ type: "consume-pending-intent" });
        }
      }
    },
    [
      authGeneration,
      refreshVisitorSettings,
      requestAuthorizedJson,
      transitionClient,
    ],
  );

  const persistCollectionPayload = useCallback(
    async ({ nextRecords = null, nextGenreOptions = null, action }) => {
      if (collectionWriteInFlightRef.current) {
        const error = new Error("A collection save is already in progress.");
        error.code = "WRITE_IN_PROGRESS";
        throw error;
      }

      const requestGeneration = authGeneration.capture();
      collectionWriteInFlightRef.current = true;
      setCollectionWriteError(null);
      try {
        if (nextGenreOptions !== null) {
          const genrePayload = {
            genres: cloneValue(nextGenreOptions.genres),
            subGenres: cloneValue(nextGenreOptions.subGenres),
          };
          await requestAuthorizedJson(
            "/api/genre-options",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(genrePayload),
            },
            action,
          );
          if (!authGeneration.isCurrent(requestGeneration)) return false;
          genresRef.current = genrePayload.genres;
          subGenresRef.current = genrePayload.subGenres;
          setGenres(genrePayload.genres);
          setSubGenres(genrePayload.subGenres);
        }

        if (nextRecords !== null) {
          const recordsPayload = cloneValue(nextRecords);
          await requestAuthorizedJson(
            "/api/records",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ records: recordsPayload }),
            },
            action,
          );
          if (!authGeneration.isCurrent(requestGeneration)) return false;
          recordsRef.current = recordsPayload;
          setRecords(recordsPayload);
        }

        if (
          action &&
          clientStateRef.current.administrator.pendingIntent?.type ===
            action.type
        ) {
          transitionClient({ type: "consume-pending-intent" });
        }
        return true;
      } catch (error) {
        if (error?.status !== 401 && !authGeneration.isCurrent(requestGeneration)) {
          return false;
        }
        if (error?.status !== 401) {
          setCollectionWriteError(errorMessage(error));
          if (
            action &&
            clientStateRef.current.administrator.pendingIntent?.type ===
              action.type
          ) {
            transitionClient({ type: "consume-pending-intent" });
          }
        }
        throw error;
      } finally {
        collectionWriteInFlightRef.current = false;
      }
    },
    [authGeneration, requestAuthorizedJson, transitionClient],
  );

  const completeResumedCollectionWrite = useCallback((action) => {
    switch (getCollectionWriteSuccessCleanup(action)) {
      case "close-add-record":
        setShowAddRecord(false);
        break;
      case "close-edit-record":
        setEditingRecord(null);
        break;
      case "close-discogs-import":
        setShowDiscogsImport(false);
        break;
      case "keep-open":
        setCollectionWriteError(null);
        break;
      default:
        break;
    }
  }, []);

  const handleSignIn = useCallback(
    async (password) => {
      const requestGeneration = authGeneration.invalidate();
      setSignInSubmitting(true);
      let pending = null;
      try {
        const response = await requestJson("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (response.authenticated !== true) {
          throw new Error("Unable to sign in.");
        }
        if (!authGeneration.isCurrent(requestGeneration)) return;

        pending = cloneValue(
          clientStateRef.current.administrator.pendingIntent,
        );
        transitionClient({ type: "sign-in-succeeded" });
      } catch (error) {
        if (!authGeneration.isCurrent(requestGeneration)) return;
        transitionClient({
          type: "sign-in-failed",
          error: errorMessage(error),
        });
        return;
      } finally {
        setSignInSubmitting(false);
      }

      if (!authGeneration.isCurrent(requestGeneration)) return;
      if (pending?.type === "settings-save") {
        await saveSettingsSection(pending.section, pending.draft);
      } else if (pending?.type === "settings-remove") {
        await removeSettingsSection(pending.section);
      } else if (pending?.type === "records-save") {
        try {
          await persistCollectionPayload({
            nextRecords: pending.records,
            nextGenreOptions: pending.genreOptions ?? null,
            action: pending,
          });
          completeResumedCollectionWrite(pending);
        } catch {
          // The write surface retains its input and reports the failure.
        }
      } else if (pending?.type === "genre-options-save") {
        try {
          await persistCollectionPayload({
            nextGenreOptions: {
              genres: pending.genres,
              subGenres: pending.subGenres,
            },
            action: pending,
          });
          completeResumedCollectionWrite(pending);
        } catch {
          // The write surface retains its input and reports the failure.
        }
      }
    },
    [
      persistCollectionPayload,
      removeSettingsSection,
      saveSettingsSection,
      completeResumedCollectionWrite,
      transitionClient,
      authGeneration,
    ],
  );

  const signOut = useCallback(async () => {
    if (!(await requestAdminLogout())) return;
    transitionClient({ type: "sign-out" });
  }, [requestAdminLogout, transitionClient]);

  const resetTransientUi = useCallback(() => {
    setEditingRecord(null);
    setShowAddRecord(false);
    setShowDiscogsImport(false);
  }, []);

  const resetToHome = useCallback(
    async (actionType = "home-selected") => {
      if (!(await requestAdminLogout())) return;
      resetTransientUi();
      transitionClient({ type: actionType }, { historyMode: "replace" });
      window.history.replaceState({}, "", "/");
    },
    [requestAdminLogout, resetTransientUi, transitionClient],
  );

  const leaveSettings = useCallback(
    (action) => {
      const current = clientStateRef.current;
      const next = transitionClient(action, { historyMode: "replace" });
      if (
        current.navigation.path === "/settings" &&
        next.navigation.path !== "/settings" &&
        current.navigation.returnIntent?.type === "sync"
      ) {
        setShowDiscogsImport(true);
      }
    },
    [transitionClient],
  );

  const cancelSignIn = useCallback(() => {
    const current = clientStateRef.current;
    const next = transitionClient(
      { type: "cancel-sign-in" },
      { historyMode: "replace" },
    );
    if (
      current.navigation.path === "/settings" &&
      next.navigation.path !== "/settings" &&
      current.navigation.returnIntent?.type === "sync"
    ) {
      setShowDiscogsImport(true);
    }
  }, [transitionClient]);

  const handleHome = useCallback(() => {
    void resetToHome("home-selected");
  }, [resetToHome]);

  const handleOpenPhone = useCallback(() => {
    window.scrollTo(0, 0);
    transitionClient(
      { type: "handoff-open", step: "loading" },
      { historyMode: "none" },
    );
    loadVisitorSettings(true).then((settings) => {
      const current = clientStateRef.current;
      if (current.visitor.handoffStep !== "loading") return;
      transitionClient(
        {
          type: "handoff-step",
          step: settings.wifi ? "connecting" : "collection",
        },
        { historyMode: "none" },
      );
    }).catch(() => {});
  }, [loadVisitorSettings, transitionClient]);

  const handleHandoffStep = useCallback(
    (step) => {
      transitionClient({ type: "handoff-step", step }, { historyMode: "none" });
    },
    [transitionClient],
  );

  const handleStartOver = useCallback(() => {
    window.scrollTo(0, 0);
    transitionClient({ type: "handoff-close" }, { historyMode: "none" });
  }, [transitionClient]);

  const handleRequestEditMode = useCallback(async () => {
    if (!clientStateRef.current.administrator.authenticated) {
      transitionClient({ type: "edit-mode-enabled" });
      return;
    }

    const requestGeneration = authGeneration.capture();
    try {
      const session = await requestJson("/api/auth/session");
      if (!authGeneration.isCurrent(requestGeneration)) return;
      transitionClient({
        type: "auth-status",
        configured: session.configured,
        authenticated: session.authenticated,
      });
    } catch {
      if (!authGeneration.isCurrent(requestGeneration)) return;
      transitionClient({
        type: "auth-status",
        authenticated: false,
      });
    }
    transitionClient({ type: "edit-mode-enabled" });
  }, [authGeneration, transitionClient]);

  const handleEnterDisplay = useCallback(() => {
    window.scrollTo(0, 0);
    window.history.pushState({ displayMode: true }, "", "/");
    transitionClient({ type: "enter-display" }, { historyMode: "none" });
    loadVisitorSettings(true).catch(() => {});
  }, [loadVisitorSettings, transitionClient]);

  const handleVisitorTimeout = useCallback(() => {
    if (!isVisitorTimerActive(clientStateRef.current)) return;
    void resetToHome("visitor-timeout");
  }, [resetToHome]);

  const visitorTimerScope = isVisitorTimerActive(clientState)
    ? `${clientState.navigation.path}:${clientState.visitor.displayMode ? "display" : clientState.visitor.handoffStep}`
    : null;

  useEffect(() => {
    if (!visitorTimerScope) {
      setVisitorTimerSnapshot(null);
      return undefined;
    }

    let timer = createVisitorTimer({
      timeoutMinutes: visitorSettings.idleTimeoutMinutes,
    });

    const updateSnapshot = () => {
      const snapshot = getVisitorTimerSnapshot(timer);
      setVisitorTimerSnapshot(snapshot);
      if (snapshot.expired) handleVisitorTimeout();
    };

    const resetForActivity = (event) => {
      if (!isVisitorActivityEvent(event)) return;
      timer = resetVisitorTimer(timer, {
        timeoutMinutes: normalizeVisitorTimeoutMinutes(
          visitorSettings.idleTimeoutMinutes,
        ),
      });
    };

    const activityEvents = [
      "pointerdown",
      "touchstart",
      "keydown",
      "input",
      "change",
      "click",
    ];
    for (const eventName of activityEvents) {
      document.addEventListener(eventName, resetForActivity, {
        capture: true,
        passive: true,
      });
    }
    window.addEventListener("scroll", resetForActivity, true);

    updateSnapshot();
    const intervalId = window.setInterval(updateSnapshot, 250);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("scroll", resetForActivity, true);
      for (const eventName of activityEvents) {
        document.removeEventListener(eventName, resetForActivity, true);
      }
    };
  }, [
    handleVisitorTimeout,
    visitorSettings.idleTimeoutMinutes,
    visitorTimerScope,
  ]);

  async function handleAdd(newRecord) {
    const nextRecords = addRecord(
      recordsRef.current,
      newRecord,
      generateId(),
    );
    await persistCollectionPayload({
      nextRecords,
      action: {
        type: "records-save",
        records: cloneValue(nextRecords),
        completion: "add-record",
      },
    });
    setShowAddRecord(false);
  }

  async function handleDelete(id) {
    const nextRecords = deleteRecord(recordsRef.current, id);
    await persistCollectionPayload({
      nextRecords,
      action: {
        type: "records-save",
        records: cloneValue(nextRecords),
        completion: "delete-record",
      },
    });
    setEditingRecord(null);
  }

  async function handleDiscogsImport(
    newRecords,
    updates,
    deletions = [],
  ) {
    const nextRecords = applyDiscogsImport(
      recordsRef.current,
      newRecords,
      updates,
      deletions,
      generateId,
    );
    const nextGenres = newRecords
      .map((record) => record.genre)
      .filter(Boolean)
      .reduce((values, genre) => addGenre(values, genre), genresRef.current);
    const nextSubGenres = newRecords
      .flatMap((record) => record.subGenres ?? [])
      .reduce(
        (values, subGenre) => addSubGenre(values, subGenre),
        subGenresRef.current,
      );
    const nextGenreOptions =
      JSON.stringify(nextGenres) === JSON.stringify(genresRef.current) &&
      JSON.stringify(nextSubGenres) === JSON.stringify(subGenresRef.current)
        ? null
        : { genres: nextGenres, subGenres: nextSubGenres };
    const action = {
      type: "records-save",
      records: cloneValue(nextRecords),
      completion: "discogs-import",
      ...(nextGenreOptions
        ? { genreOptions: cloneValue(nextGenreOptions) }
        : {}),
    };

    await persistCollectionPayload({
      nextRecords,
      nextGenreOptions,
      action,
    });
    setShowDiscogsImport(false);
  }

  async function handleEdit(id, updatedFields) {
    const nextRecords = editRecord(
      recordsRef.current,
      id,
      updatedFields,
    );
    await persistCollectionPayload({
      nextRecords,
      action: {
        type: "records-save",
        records: cloneValue(nextRecords),
        completion: "edit-record",
      },
    });
    setEditingRecord(null);
  }

  const handleAddSubGenre = useCallback(
    async (newSubGenre) => {
      if (subGenresRef.current.includes(newSubGenre)) return true;
      const nextSubGenres = addSubGenre(
        subGenresRef.current,
        newSubGenre,
      );
      await persistCollectionPayload({
        nextGenreOptions: {
          genres: cloneValue(genresRef.current),
          subGenres: nextSubGenres,
        },
        action: {
          type: "genre-options-save",
          genres: cloneValue(genresRef.current),
          subGenres: cloneValue(nextSubGenres),
          completion: "genre-options",
        },
      });
      return true;
    },
    [persistCollectionPayload],
  );

  const handleDeleteSubGenre = useCallback(
    async (subGenre) => {
      if (!subGenresRef.current.includes(subGenre)) return true;
      const nextSubGenres = deleteSubGenre(
        subGenresRef.current,
        subGenre,
      );
      await persistCollectionPayload({
        nextGenreOptions: {
          genres: cloneValue(genresRef.current),
          subGenres: nextSubGenres,
        },
        action: {
          type: "genre-options-save",
          genres: cloneValue(genresRef.current),
          subGenres: cloneValue(nextSubGenres),
          completion: "genre-options",
        },
      });
      return true;
    },
    [persistCollectionPayload],
  );

  const handleAddGenre = useCallback(
    async (newGenre) => {
      if (genresRef.current.includes(newGenre)) return true;
      const nextGenres = addGenre(genresRef.current, newGenre);
      await persistCollectionPayload({
        nextGenreOptions: {
          genres: nextGenres,
          subGenres: cloneValue(subGenresRef.current),
        },
        action: {
          type: "genre-options-save",
          genres: cloneValue(nextGenres),
          subGenres: cloneValue(subGenresRef.current),
          completion: "genre-options",
        },
      });
      return true;
    },
    [persistCollectionPayload],
  );

  const updatePrompt = (
    <UpdatePrompt
      isUpdateAvailable={isUpdateAvailable}
      onReload={handleReload}
    />
  );
  const path = clientState.navigation.path;
  const showHome = path === "/" && !clientState.visitor.displayMode;
  const showCollection =
    path === "/browse" || (path === "/" && clientState.visitor.displayMode);
  const showSettings = path === "/settings";
  const showHandoff =
    path === "/" && clientState.visitor.handoffStep !== null;
  const countdownSeconds = visitorTimerSnapshot?.isWarning
    ? visitorTimerSnapshot.countdownSeconds
    : 0;

  if (loading && showCollection) {
    return (
      <div className="variant-c app-loading">
        {updatePrompt}
        <p>Loading collection…</p>
      </div>
    );
  }

  return (
    <>
      {updatePrompt}
      {showHome && (
        <HomeScreen
          records={records}
          onBrowse={handleEnterDisplay}
          onOpenPhone={handleOpenPhone}
        />
      )}
      {showCollection && (
        <ListeningRoom
          records={records}
          editMode={clientState.administrator.editMode}
          authenticated={clientState.administrator.authenticated}
          onEditRecord={(record) => {
            setCollectionWriteError(null);
            setEditingRecord(record);
          }}
          onRequestEditMode={handleRequestEditMode}
          onLockEditMode={() =>
            transitionClient({ type: "edit-mode-disabled" })
          }
          onRequestAddRecord={() => {
            setCollectionWriteError(null);
            setShowAddRecord(true);
          }}
          onSync={() => {
            setCollectionWriteError(null);
            setShowDiscogsImport(true);
          }}
          onHome={handleHome}
          onSettings={() =>
            transitionClient({
              type: "request-navigation",
              path: "/settings",
              returnIntent: {
                type: "collection-display",
                displayMode: clientStateRef.current.visitor.displayMode,
              },
            })
          }
          onSignOut={signOut}
        />
      )}
      {showHandoff && (
        <VisitorHandoffModal
          step={clientState.visitor.handoffStep}
          settings={visitorSettings}
          settingsError={visitorSettingsError}
          onStep={handleHandoffStep}
          onStartOver={handleStartOver}
          onRetry={handleOpenPhone}
          countdownSeconds={countdownSeconds}
        />
      )}
      {visitorSettingsError && (showHome || showCollection) && (
        <div className="visitor-settings-error" role="alert">
          Visitor settings are unavailable: {visitorSettingsError}
        </div>
      )}
      {adminSessionError && (showHome || showCollection) && (
        <div className="visitor-settings-error" role="alert">
          {adminSessionError}
        </div>
      )}
      {clientState.visitor.displayMode && countdownSeconds > 0 && (
        <div
          className="visitor-reset-countdown"
          data-visitor-timer="true"
          role="status"
          aria-live="assertive"
        >
          Returning to Home Screen in {countdownSeconds} seconds.
        </div>
      )}
      {showSettings && (
        <SettingsPage
          settings={clientState.settings}
          onSelectSection={(section) =>
            transitionClient({
              type: "settings-select-section",
              section,
            })
          }
          onDraftChange={(section, draft) =>
            transitionClient({
              type: "settings-draft-changed",
              section,
              draft,
            })
          }
          onSaveSection={(section) =>
            saveSettingsSection(
              section,
              clientStateRef.current.settings.sections[section]?.draft,
            )
          }
          onDiscardSection={(section) => {
            const saved =
              clientStateRef.current.settings.sections[section]?.saved ?? null;
            transitionClient({
              type: "settings-draft-changed",
              section,
              draft: saved,
            });
          }}
          onRemoveSection={removeSettingsSection}
          onCancel={() => leaveSettings({ type: "cancel-settings" })}
          onKeepEditing={() => transitionClient({ type: "keep-editing" })}
          onDiscardAndLeave={() => leaveSettings({ type: "discard-and-leave" })}
          onRetry={() => transitionClient({ type: "settings-retry" })}
        />
      )}

      {showAddRecord && (
        <AddRecordForm
          onAdd={handleAdd}
          onClose={() => setShowAddRecord(false)}
          error={collectionWriteError}
          writeBlocked={
            clientState.administrator.pendingIntent?.type === "records-save"
          }
          genres={genres}
          subGenres={subGenres}
          onAddSubGenre={handleAddSubGenre}
          onDeleteSubGenre={handleDeleteSubGenre}
          onAddGenre={handleAddGenre}
        />
      )}
      {editingRecord && (
        <EditRecordModal
          key={editingRecord.id}
          record={editingRecord}
          onSave={handleEdit}
          onDelete={
            clientState.administrator.editMode ? handleDelete : null
          }
          onClose={() => setEditingRecord(null)}
          readOnly={
            !clientState.administrator.editMode &&
            clientState.administrator.pendingIntent?.type !== "records-save"
          }
          writeBlocked={
            clientState.administrator.pendingIntent?.type === "records-save"
          }
          error={collectionWriteError}
          genres={genres}
          subGenres={subGenres}
          onAddSubGenre={handleAddSubGenre}
          onDeleteSubGenre={handleDeleteSubGenre}
          onAddGenre={handleAddGenre}
        />
      )}
      {showDiscogsImport && (
        <DiscogsImport
          existingRecords={records}
          onImport={handleDiscogsImport}
          onClose={() => setShowDiscogsImport(false)}
          onConfigureCredentials={handleOpenDiscogsSettings}
          onSessionExpired={handleDiscogsSessionExpired}
          discogsConfig={discogsConfig}
          discogsConfigLoading={discogsConfigLoading}
          discogsConfigError={discogsConfigError}
          writeError={collectionWriteError}
        />
      )}
      <SignInChallenge
        key={`${clientState.administrator.challenge.open}-${clientState.administrator.challenge.message}`}
        open={clientState.administrator.challenge.open}
        message={clientState.administrator.challenge.message ?? "Sign in"}
        error={clientState.administrator.challenge.error}
        onSubmit={handleSignIn}
        onCancel={cancelSignIn}
        submitting={signInSubmitting}
      />
    </>
  );
}

export default App;
