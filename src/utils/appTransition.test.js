import { describe, expect, it } from "vitest";
import {
  canDiscardSettingsSection,
  createClientState,
  isSettingsSaving,
  isVisitorTimerActive,
  normalizePath,
  transition,
} from "./appTransition.js";

describe("client transition", () => {
  it("normalizes unsupported browser paths to the public Home Screen", () => {
    expect(normalizePath("/not-a-view")).toBe("/");
    expect(normalizePath("/settings?section=wifi")).toBe("/settings");
  });

  it("keeps Collection Display state separate from the addressable browse path", () => {
    const entered = transition(createClientState("/"), {
      type: "enter-display",
    });
    const exited = transition(entered, { type: "exit-display" });

    expect(entered.navigation.path).toBe("/");
    expect(entered.visitor.displayMode).toBe(true);
    expect(exited.navigation.path).toBe("/");
    expect(exited.visitor.displayMode).toBe(false);
    expect(exited.administrator.authenticated).toBe(false);
  });

  it("tracks the visitor phone handoff separately from Collection Display", () => {
    const opened = transition(createClientState("/"), {
      type: "handoff-open",
      step: "connecting",
    });
    const collection = transition(opened, {
      type: "handoff-step",
      step: "collection",
    });

    expect(opened.navigation.path).toBe("/");
    expect(opened.visitor).toMatchObject({
      handoffStep: "connecting",
      displayMode: false,
    });
    expect(collection.visitor.handoffStep).toBe("collection");
    expect(isVisitorTimerActive(collection)).toBe(true);
  });

  it("safely resets Home handoff and Collection Display on visitor timeout", () => {
    let state = transition(createClientState("/"), {
      type: "handoff-open",
      step: "collection",
    });
    state = transition(state, {
      type: "auth-status",
      authenticated: true,
    });
    state = transition(state, { type: "edit-mode-enabled" });
    const timedOut = transition(state, { type: "visitor-timeout" });

    expect(timedOut.navigation.path).toBe("/");
    expect(timedOut.visitor).toEqual({
      handoffStep: null,
      displayMode: false,
    });
    expect(timedOut.administrator.authenticated).toBe(false);
    expect(timedOut.administrator.editMode).toBe(false);
    expect(timedOut.administrator.pendingIntent).toBeNull();
  });

  it("ignores visitor timeout from direct phone browsing", () => {
    const state = createClientState("/browse");

    expect(isVisitorTimerActive(state)).toBe(false);
    expect(transition(state, { type: "visitor-timeout" })).toBe(state);
  });

  it("clears Home handoff state when navigation enters direct phone browsing", () => {
    const state = transition(createClientState("/"), {
      type: "handoff-open",
      step: "collection",
    });
    const directBrowse = transition(state, {
      type: "location-changed",
      path: "/browse",
    });

    expect(directBrowse.navigation.path).toBe("/browse");
    expect(directBrowse.visitor).toEqual({
      handoffStep: null,
      displayMode: false,
    });
    expect(isVisitorTimerActive(directBrowse)).toBe(false);
  });

  it("normalizes direct settings navigation and keeps a browse return target", () => {
    const state = createClientState("/settings");
    const next = transition(state, {
      type: "auth-status",
      configured: true,
      authenticated: false,
    });

    expect(next.navigation.path).toBe("/settings");
    expect(next.navigation.returnPath).toBeNull();
    expect(next.administrator.challenge).toMatchObject({
      open: true,
      message: "Sign in to open Settings",
    });
    expect(next.administrator.pendingIntent).toEqual({
      type: "settings",
    });
  });

  it("keeps generic sign-in in View Mode", () => {
    const state = createClientState("/browse");
    const challenged = transition(state, {
      type: "request-sign-in",
      intent: { type: "generic" },
      message: "Sign in",
    });
    const signedIn = transition(challenged, {
      type: "sign-in-succeeded",
    });

    expect(signedIn.navigation.path).toBe("/browse");
    expect(signedIn.administrator.authenticated).toBe(true);
    expect(signedIn.administrator.editMode).toBe(false);
    expect(signedIn.administrator.challenge.open).toBe(false);
  });

  it("does not let a generic sign-in inherit Edit Mode", () => {
    let state = transition(createClientState("/browse"), {
      type: "auth-status",
      authenticated: true,
    });
    state = transition(state, { type: "edit-mode-enabled" });
    state = transition(state, {
      type: "request-sign-in",
      intent: { type: "generic" },
    });
    const signedIn = transition(state, { type: "sign-in-succeeded" });

    expect(signedIn.administrator.editMode).toBe(false);
  });

  it("turns off Edit Mode when the server reports an expired session", () => {
    let state = transition(createClientState("/browse"), {
      type: "auth-status",
      authenticated: true,
    });
    state = transition(state, { type: "edit-mode-enabled" });
    const expired = transition(state, {
      type: "auth-status",
      authenticated: false,
    });

    expect(expired.administrator.authenticated).toBe(false);
    expect(expired.administrator.editMode).toBe(false);
  });

  it("resumes Edit Mode only for an Edit Mode intent", () => {
    const challenged = transition(createClientState("/browse"), {
      type: "request-sign-in",
      intent: { type: "edit-mode" },
      message: "Sign in to enable Edit Mode",
    });
    const signedIn = transition(challenged, {
      type: "sign-in-succeeded",
    });

    expect(signedIn.administrator.authenticated).toBe(true);
    expect(signedIn.administrator.editMode).toBe(true);
    expect(signedIn.navigation.path).toBe("/browse");
  });

  it("opens Settings after a Settings intent succeeds", () => {
    const challenged = transition(createClientState("/browse"), {
      type: "request-navigation",
      path: "/settings",
    });
    const signedIn = transition(challenged, {
      type: "sign-in-succeeded",
    });

    expect(signedIn.navigation.path).toBe("/settings");
    expect(signedIn.navigation.returnPath).toBe("/browse");
    expect(signedIn.administrator.pendingIntent).toBeNull();
  });

  it("focuses Discogs and retains a Sync return intent while opening Settings", () => {
    const next = transition(createClientState("/browse"), {
      type: "request-navigation",
      path: "/settings",
      hash: "#discogs",
      returnIntent: { type: "sync" },
    });

    expect(next.navigation).toMatchObject({
      path: "/settings",
      hash: "#discogs",
      returnPath: "/browse",
      returnIntent: { type: "sync" },
    });
    expect(next.settings.activeSection).toBe("discogs");
    expect(next.administrator.pendingIntent).toEqual({ type: "settings" });

    const signedIn = transition(next, { type: "sign-in-succeeded" });
    expect(signedIn.navigation.returnIntent).toEqual({ type: "sync" });
  });

  it("restores the Discogs section for a direct Settings hash", () => {
    const state = createClientState("/settings", "#discogs");
    const next = transition(state, {
      type: "auth-status",
      configured: true,
      authenticated: false,
    });

    expect(next.navigation.hash).toBe("#discogs");
    expect(next.settings.activeSection).toBe("discogs");
    expect(next.administrator.challenge.message).toBe(
      "Sign in to open Settings",
    );
  });

  it("keeps the Settings section and URL hash synchronized", () => {
    let state = transition(createClientState("/settings"), {
      type: "auth-status",
      authenticated: true,
    });
    state = transition(state, {
      type: "settings-select-section",
      section: "discogs",
    });

    expect(state.navigation.hash).toBe("#discogs");
    expect(state.settings.activeSection).toBe("discogs");

    const returned = transition(state, {
      type: "location-changed",
      path: "/settings",
      hash: "",
    });
    expect(returned.navigation.hash).toBe("");
    expect(returned.settings.activeSection).toBe("visitorDisplay");
  });

  it("returns a Sync launch from Collection Display without losing display mode", () => {
    let state = transition(createClientState("/"), {
      type: "enter-display",
    });
    state = transition(state, {
      type: "auth-status",
      authenticated: true,
    });
    state = transition(state, { type: "edit-mode-enabled" });
    state = transition(state, {
      type: "request-navigation",
      path: "/settings",
      hash: "#discogs",
      returnIntent: { type: "sync", displayMode: true },
    });

    const returned = transition(state, { type: "cancel-settings" });
    expect(returned.navigation.path).toBe("/");
    expect(returned.visitor.displayMode).toBe(true);
    expect(returned.administrator.authenticated).toBe(true);
    expect(returned.administrator.editMode).toBe(true);
  });

  it("returns Settings opened from Collection Display to the same display mode", () => {
    let state = transition(createClientState("/"), {
      type: "enter-display",
    });
    state = transition(state, {
      type: "request-navigation",
      path: "/settings",
      returnIntent: { type: "collection-display", displayMode: true },
    });

    const returned = transition(state, { type: "cancel-settings" });

    expect(returned.navigation.path).toBe("/");
    expect(returned.visitor.displayMode).toBe(true);
  });

  it("preserves Collection Display mode when discarding Settings changes", () => {
    let state = transition(createClientState("/"), {
      type: "enter-display",
    });
    state = transition(state, {
      type: "settings-loaded",
      settings: {
        visitorDisplay: { idleTimeoutMinutes: 3 },
        wifi: null,
        discogs: {
          username: "",
          hasToken: false,
          source: "none",
          canEdit: true,
        },
      },
    });
    state = transition(state, {
      type: "request-navigation",
      path: "/settings",
      returnIntent: { type: "collection-display", displayMode: true },
    });
    state = transition(state, {
      type: "settings-draft-changed",
      section: "visitorDisplay",
      draft: { idleTimeoutMinutes: 8 },
    });
    state = transition(state, { type: "cancel-settings" });
    const discarded = transition(state, { type: "discard-and-leave" });

    expect(discarded.navigation.path).toBe("/");
    expect(discarded.visitor.displayMode).toBe(true);
    expect(discarded.settings.sections.visitorDisplay.draft).toEqual({
      idleTimeoutMinutes: 3,
    });
  });

  it("names dirty sections before leaving Settings", () => {
    let state = createClientState("/settings");
    state = transition(state, {
      type: "settings-loaded",
      settings: {
        visitorDisplay: { idleTimeoutMinutes: 3 },
        wifi: null,
        discogs: { username: "", hasToken: false, source: "none", canEdit: true },
      },
    });
    state = transition(state, {
      type: "settings-draft-changed",
      section: "wifi",
      draft: {
        security: "wpa",
        ssid: "Example",
        password: "password",
        hidden: false,
      },
    });
    const warned = transition(state, {
      type: "request-navigation",
      path: "/browse",
    });

    expect(warned.navigation.path).toBe("/settings");
    expect(warned.settings.navigationPrompt).toEqual({
      path: "/browse",
      sections: ["Wi-Fi"],
    });
  });

  it("discards dirty settings and completes the pending navigation", () => {
    let state = createClientState("/settings");
    state = transition(state, {
      type: "settings-loaded",
      settings: {
        visitorDisplay: { idleTimeoutMinutes: 3 },
        wifi: null,
        discogs: { username: "", hasToken: false, source: "none", canEdit: true },
      },
    });
    state = transition(state, {
      type: "settings-draft-changed",
      section: "visitorDisplay",
      draft: { idleTimeoutMinutes: 7 },
    });
    state = transition(state, {
      type: "request-navigation",
      path: "/browse",
    });
    const next = transition(state, { type: "discard-and-leave" });

    expect(next.navigation.path).toBe("/browse");
    expect(next.settings.navigationPrompt).toBeNull();
    expect(next.settings.sections.visitorDisplay.draft).toEqual({
      idleTimeoutMinutes: 3,
    });
  });

  it("blocks Settings navigation and discard while a section save is in flight", () => {
    let state = createClientState("/settings");
    state = transition(state, {
      type: "settings-loaded",
      settings: {
        visitorDisplay: { idleTimeoutMinutes: 3 },
        wifi: {
          security: "wpa",
          ssid: "Example",
          password: "password",
          hidden: false,
        },
        discogs: {
          username: "",
          hasToken: false,
          source: "none",
          canEdit: true,
        },
      },
    });
    state = transition(state, {
      type: "settings-draft-changed",
      section: "wifi",
      draft: {
        security: "wpa",
        ssid: "Updated",
        password: "password",
        hidden: false,
      },
    });
    state = transition(state, {
      type: "settings-save-started",
      section: "wifi",
    });

    expect(isSettingsSaving(state)).toBe(true);
    expect(
      transition(state, { type: "request-navigation", path: "/browse" }),
    ).toBe(state);
    expect(transition(state, { type: "cancel-settings" })).toBe(state);
    expect(transition(state, { type: "discard-and-leave" })).toBe(state);
    expect(
      transition(state, {
        type: "settings-select-section",
        section: "discogs",
      }),
    ).toBe(state);
  });

  it("does not discard after navigation was requested before a save started", () => {
    let state = createClientState("/settings");
    state = transition(state, {
      type: "settings-loaded",
      settings: {
        visitorDisplay: { idleTimeoutMinutes: 3 },
        wifi: null,
        discogs: {
          username: "",
          hasToken: false,
          source: "none",
          canEdit: true,
        },
      },
    });
    state = transition(state, {
      type: "settings-draft-changed",
      section: "visitorDisplay",
      draft: { idleTimeoutMinutes: 8 },
    });
    state = transition(state, {
      type: "request-navigation",
      path: "/browse",
    });
    state = transition(state, {
      type: "settings-save-started",
      section: "visitorDisplay",
    });

    expect(transition(state, { type: "discard-and-leave" })).toBe(state);
    expect(state.navigation.path).toBe("/settings");
    expect(state.settings.sections.visitorDisplay.status).toBe("saving");
  });

  it("settles every concurrent Settings save when one session expires", () => {
    const visitorDraft = { idleTimeoutMinutes: 8 };
    const wifiDraft = {
      security: "wpa",
      ssid: "Updated",
      password: "password",
      hidden: false,
    };
    let state = createClientState("/settings");
    state = transition(state, {
      type: "settings-loaded",
      settings: {
        visitorDisplay: { idleTimeoutMinutes: 3 },
        wifi: {
          security: "wpa",
          ssid: "Example",
          password: "password",
          hidden: false,
        },
        discogs: {
          username: "",
          hasToken: false,
          source: "none",
          canEdit: true,
        },
      },
    });
    state = transition(state, {
      type: "settings-draft-changed",
      section: "visitorDisplay",
      draft: visitorDraft,
    });
    state = transition(state, {
      type: "settings-draft-changed",
      section: "wifi",
      draft: wifiDraft,
    });
    state = transition(state, {
      type: "settings-save-started",
      section: "visitorDisplay",
    });
    state = transition(state, {
      type: "settings-save-started",
      section: "wifi",
    });

    const expired = transition(state, {
      type: "session-expired",
      action: {
        type: "settings-save",
        section: "wifi",
        draft: wifiDraft,
      },
    });

    expect(expired.settings.sections.visitorDisplay.status).toBe("dirty");
    expect(expired.settings.sections.wifi.status).toBe("dirty");
    expect(expired.administrator.pendingIntent).toEqual({
      type: "settings-save",
      section: "wifi",
      draft: wifiDraft,
    });
    expect(
      Object.values(expired.settings.sections).some(
        (section) => section.status === "saving",
      ),
    ).toBe(false);
    expect(
      transition(expired, {
        type: "settings-save-succeeded",
        section: "visitorDisplay",
        saved: visitorDraft,
      }),
    ).toBe(expired);
  });

  it("keeps failed-save errors visible while allowing local discard", () => {
    const saved = { idleTimeoutMinutes: 3 };
    const draft = { idleTimeoutMinutes: 8 };
    let state = createClientState("/settings");
    state = transition(state, {
      type: "settings-loaded",
      settings: { visitorDisplay: saved, wifi: null, discogs: null },
    });
    state = transition(state, {
      type: "settings-draft-changed",
      section: "visitorDisplay",
      draft,
    });
    state = transition(state, {
      type: "settings-save-started",
      section: "visitorDisplay",
    });
    state = transition(state, {
      type: "settings-save-failed",
      section: "visitorDisplay",
      validation: false,
      error: "The server rejected this value.",
    });

    const failedSection = state.settings.sections.visitorDisplay;
    expect(failedSection.status).toBe("server-error");
    expect(failedSection.error).toBe("The server rejected this value.");
    expect(canDiscardSettingsSection(failedSection)).toBe(true);
    expect(
      canDiscardSettingsSection({ ...failedSection, status: "saving" }),
    ).toBe(false);

    const discarded = transition(state, {
      type: "settings-draft-changed",
      section: "visitorDisplay",
      draft: saved,
    });
    expect(discarded.settings.sections.visitorDisplay).toMatchObject({
      draft: saved,
      saved,
      status: "clean",
      error: null,
      message: null,
    });
  });

  it("retains an exact expired save intent for re-authentication", () => {
    const draft = {
      security: "wpa",
      ssid: "Example",
      password: "password",
      hidden: false,
    };
    let state = createClientState("/settings");
    state = transition(state, {
      type: "settings-loaded",
      settings: {
        visitorDisplay: { idleTimeoutMinutes: 3 },
        wifi: null,
        discogs: { username: "", hasToken: false, source: "none", canEdit: true },
      },
    });
    state = transition(state, {
      type: "settings-draft-changed",
      section: "wifi",
      draft,
    });
    state = transition(state, {
      type: "settings-save-started",
      section: "wifi",
    });
    const expired = transition(state, {
      type: "session-expired",
      action: {
        type: "settings-save",
        section: "wifi",
        draft,
      },
    });

    expect(expired.administrator.authenticated).toBe(false);
    expect(expired.administrator.editMode).toBe(false);
    expect(expired.administrator.challenge.message).toBe(
      "Sign in again to finish saving",
    );
    expect(expired.administrator.pendingIntent).toEqual({
      type: "settings-save",
      section: "wifi",
      draft,
    });
    expect(expired.settings.sections.wifi.status).toBe("dirty");
  });

  it("ignores draft edits and duplicate save starts while a section is saving", () => {
    let state = createClientState("/settings");
    state = transition(state, {
      type: "settings-loaded",
      settings: {
        visitorDisplay: { idleTimeoutMinutes: 3 },
        wifi: {
          security: "wpa",
          ssid: "Example",
          password: "password",
          hidden: false,
        },
        discogs: {
          username: "",
          hasToken: false,
          source: "none",
          canEdit: true,
        },
      },
    });
    state = transition(state, {
      type: "settings-draft-changed",
      section: "wifi",
      draft: {
        security: "wpa",
        ssid: "Updated",
        password: "password",
        hidden: false,
      },
    });
    state = transition(state, {
      type: "settings-save-started",
      section: "wifi",
    });

    const duplicateStart = transition(state, {
      type: "settings-save-started",
      section: "wifi",
    });
    const attemptedEdit = transition(state, {
      type: "settings-draft-changed",
      section: "wifi",
      draft: {
        security: "wpa",
        ssid: "Newer draft",
        password: "password",
        hidden: false,
      },
    });
    const expired = transition(state, {
      type: "session-expired",
      action: {
        type: "settings-save",
        section: "wifi",
        draft: state.settings.sections.wifi.draft,
      },
    });
    const staleCompletion = transition(expired, {
      type: "settings-save-succeeded",
      section: "wifi",
      saved: {
        security: "wpa",
        ssid: "Updated",
        password: "password",
        hidden: false,
      },
    });

    expect(duplicateStart).toEqual(state);
    expect(attemptedEdit).toEqual(state);
    expect(staleCompletion).toEqual(expired);
  });

  it("returns direct Settings cancellation to browse without ending the Admin Session", () => {
    let state = createClientState("/settings");
    state = transition(state, {
      type: "auth-status",
      configured: true,
      authenticated: true,
    });
    const next = transition(state, { type: "cancel-settings" });

    expect(next.navigation.path).toBe("/browse");
    expect(next.administrator.authenticated).toBe(true);
    expect(next.administrator.editMode).toBe(false);
  });

  it("returns an in-app Settings challenge cancellation to its origin", () => {
    const challenged = transition(
      transition(createClientState("/browse"), {
        type: "request-navigation",
        path: "/settings",
      }),
      { type: "cancel-sign-in" },
    );

    expect(challenged.navigation.path).toBe("/browse");
    expect(challenged.administrator.authenticated).toBe(false);
    expect(challenged.administrator.challenge.open).toBe(false);
  });

  it("retains a confirmed Wi-Fi removal intent through re-authentication", () => {
    const expired = transition(createClientState("/settings"), {
      type: "session-expired",
      action: { type: "settings-remove", section: "wifi" },
    });
    const signedIn = transition(expired, { type: "sign-in-succeeded" });

    expect(signedIn.administrator.authenticated).toBe(true);
    expect(signedIn.administrator.pendingIntent).toEqual({
      type: "settings-remove",
      section: "wifi",
    });
  });

  it("retains an exact records payload through an expired authorized write", () => {
    const records = [
      { id: "new-record", artist: "Björk", title: "Debut" },
    ];
    const expired = transition(createClientState("/browse"), {
      type: "session-expired",
      action: {
        type: "records-save",
        records,
        completion: "add-record",
      },
    });

    expect(expired.administrator.authenticated).toBe(false);
    expect(expired.administrator.editMode).toBe(false);
    expect(expired.administrator.challenge.message).toBe(
      "Sign in again to finish saving",
    );
    expect(expired.administrator.pendingIntent).toEqual({
      type: "records-save",
      records,
      completion: "add-record",
    });

    const signedIn = transition(expired, { type: "sign-in-succeeded" });
    expect(signedIn.administrator.authenticated).toBe(true);
    expect(signedIn.administrator.editMode).toBe(false);
    expect(signedIn.administrator.pendingIntent).toEqual({
      type: "records-save",
      records,
      completion: "add-record",
    });
  });

  it("retains an exact genre-options payload through an expired authorized write", () => {
    const genreOptions = {
      genres: ["Jazz", "Rock"],
      subGenres: ["Dream Pop"],
    };
    const expired = transition(createClientState("/browse"), {
      type: "session-expired",
      action: {
        type: "genre-options-save",
        ...genreOptions,
        completion: "genre-options",
      },
    });

    expect(expired.administrator.pendingIntent).toEqual({
      type: "genre-options-save",
      ...genreOptions,
      completion: "genre-options",
    });
    expect(
      transition(expired, { type: "sign-in-succeeded" }).administrator
        .pendingIntent,
    ).toEqual({
      type: "genre-options-save",
      ...genreOptions,
      completion: "genre-options",
    });
  });
});
