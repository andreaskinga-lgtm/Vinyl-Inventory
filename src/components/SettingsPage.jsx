import { useState } from "react";
import {
  canDiscardSettingsSection,
  isSettingsSaving,
  SETTINGS_SECTION_LABELS,
  SETTINGS_SECTIONS,
} from "../utils/appTransition.js";
import { cloneValue } from "../utils/cloneValue.js";
import "./SettingsPage.css";

const STATUS_LABELS = {
  clean: "Saved",
  dirty: "Unsaved changes",
  saving: "Saving…",
  success: "Saved",
  "validation-error": "Check fields",
  "server-error": "Save failed",
};

const EMPTY_WIFI = {
  security: "wpa",
  ssid: "",
  password: "",
  hidden: false,
};

function fieldValidationError(section, field) {
  if (section.status !== "validation-error" || !section.error) return null;

  if (
    field === "idleTimeoutMinutes" &&
    section.error.includes("idleTimeoutMinutes")
  ) {
    return section.error;
  }
  if (section.error.includes(`wifi.${field}`)) {
    return section.error;
  }
  if (
    section.error.includes("username and token") &&
    ((field === "username" && !section.draft?.username?.trim()) ||
      (field === "token" &&
        !section.draft?.token?.trim() &&
        !section.draft?.hasToken))
  ) {
    return section.error;
  }
  return null;
}

function hasFieldValidationError(section) {
  return [
    "idleTimeoutMinutes",
    "security",
    "ssid",
    "password",
    "hidden",
    "username",
    "token",
  ].some((field) => fieldValidationError(section, field));
}

function statusText(section) {
  return STATUS_LABELS[section?.status] ?? "Saved";
}

function Status({ section }) {
  return (
    <span className={`settings-status settings-status--${section.status}`}>
      {statusText(section)}
    </span>
  );
}

function SectionNav({ activeSection, sections, onSelect, disabled = false }) {
  return (
    <>
      <nav className="settings-index" aria-label="Settings sections">
        {SETTINGS_SECTIONS.map((section) => {
          const value = sections[section];
          return (
            <button
              type="button"
              key={section}
              className={activeSection === section ? "is-active" : ""}
              onClick={() => onSelect(section)}
              disabled={disabled}
              title={
                disabled ? "Wait for the current save to finish." : undefined
              }
              aria-current={activeSection === section ? "page" : undefined}
            >
              <span>{SETTINGS_SECTION_LABELS[section]}</span>
              <Status section={value} />
            </button>
          );
        })}
      </nav>
      <div
        className="settings-tabs"
        role="tablist"
        aria-label="Settings sections"
      >
        {SETTINGS_SECTIONS.map((section) => (
          <button
            type="button"
            role="tab"
            key={section}
            className={activeSection === section ? "is-active" : ""}
            onClick={() => onSelect(section)}
            disabled={disabled}
            title={
              disabled ? "Wait for the current save to finish." : undefined
            }
            aria-selected={activeSection === section}
          >
            {SETTINGS_SECTION_LABELS[section]}
          </button>
        ))}
      </div>
    </>
  );
}

function EditorActions({ section, onDiscard, onSave, disabled = false }) {
  const canDiscard = canDiscardSettingsSection(section);
  const canSave =
    section.status === "dirty" ||
    section.status === "validation-error" ||
    section.status === "server-error";
  return (
    <div className="settings-editor-actions">
      <button
        type="button"
        className="settings-secondary-action"
        onClick={onDiscard}
        disabled={!canDiscard || section.status === "saving"}
        title={
          section.status === "saving"
            ? "Wait for the current save to finish."
            : undefined
        }
      >
        Discard
      </button>
      <button
        type="button"
        className="settings-primary-action"
        onClick={onSave}
        disabled={disabled || !canSave || section.status === "saving"}
      >
        {section.status === "saving" ? "Saving…" : "Save"}
      </button>
    </div>
  );
}

function VisitorDisplayEditor({ section, onChange, onSave, onDiscard }) {
  const draft = section.draft ?? { idleTimeoutMinutes: "" };
  const saving = section.status === "saving";
  const timeoutError = fieldValidationError(section, "idleTimeoutMinutes");
  return (
    <section
      className="settings-editor"
      aria-labelledby="visitor-display-heading"
    >
      <div className="settings-editor-heading">
        <div>
          <p className="settings-eyebrow">Visitor display</p>
          <h2 id="visitor-display-heading">
            Return to Home Screen after inactivity
          </h2>
        </div>
        <Status section={section} />
      </div>
      <label className="settings-field">
        <span>Idle timeout (minutes)</span>
        <input
          type="number"
          min="1"
          max="30"
          step="1"
          value={draft.idleTimeoutMinutes}
          disabled={saving}
          aria-invalid={Boolean(timeoutError)}
          onChange={(event) =>
            onChange({
              ...draft,
              idleTimeoutMinutes:
                event.target.value === "" ? "" : Number(event.target.value),
            })
          }
        />
        <small>Choose a whole number from 1 to 30.</small>
        {timeoutError && (
          <small className="settings-field-error" role="alert">
            {timeoutError}
          </small>
        )}
      </label>
      {section.error && !hasFieldValidationError(section) && (
        <p className="settings-inline-error" role="alert">
          {section.error}
        </p>
      )}
      {section.message && <p className="settings-success">{section.message}</p>}
      <EditorActions section={section} onDiscard={onDiscard} onSave={onSave} />
    </section>
  );
}

function WifiEditor({ section, onChange, onSave, onDiscard, onRemove }) {
  const [revealed, setRevealed] = useState(false);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const draft = section.draft ?? EMPTY_WIFI;
  const hasSavedNetwork = section.saved !== null;
  const saving = section.status === "saving";

  function update(next) {
    onChange({ ...cloneValue(draft), ...next });
  }

  const securityError = fieldValidationError(section, "security");
  const ssidError = fieldValidationError(section, "ssid");
  const passwordError = fieldValidationError(section, "password");
  const hiddenError = fieldValidationError(section, "hidden");

  return (
    <section className="settings-editor" aria-labelledby="wifi-heading">
      <div className="settings-editor-heading">
        <div>
          <p className="settings-eyebrow">Wi-Fi</p>
          <h2 id="wifi-heading">Visitor Wi-Fi Network</h2>
        </div>
        <Status section={section} />
      </div>
      <label className="settings-field">
        <span>Security</span>
        <select
          value={draft.security}
          disabled={saving}
          aria-invalid={Boolean(securityError)}
          onChange={(event) => {
            const security = event.target.value;
            update({
              security,
              password: security === "open" ? "" : draft.password,
            });
          }}
        >
          <option value="wpa">Password-protected</option>
          <option value="open">Open network</option>
        </select>
        {securityError && (
          <small className="settings-field-error" role="alert">
            {securityError}
          </small>
        )}
      </label>
      <label className="settings-field">
        <span>Network name</span>
        <input
          type="text"
          value={draft.ssid}
          disabled={saving}
          aria-invalid={Boolean(ssidError)}
          onChange={(event) => update({ ssid: event.target.value })}
          autoComplete="off"
        />
        {ssidError && (
          <small className="settings-field-error" role="alert">
            {ssidError}
          </small>
        )}
      </label>
      <label className="settings-field">
        <span>Password</span>
        <div className="settings-secret-field">
          <input
            type={revealed ? "text" : "password"}
            value={draft.password}
            onChange={(event) => update({ password: event.target.value })}
            disabled={saving || draft.security === "open"}
            aria-invalid={Boolean(passwordError)}
            autoComplete="off"
          />
          <button
            type="button"
            className="settings-reveal"
            onClick={() => setRevealed((value) => !value)}
            disabled={saving || draft.security === "open"}
          >
            {revealed ? "Hide" : "Reveal"}
          </button>
        </div>
        <small>
          {draft.security === "open"
            ? "Open networks do not use a password."
            : "Passwords are hidden until you choose Reveal."}
        </small>
        {passwordError && (
          <small className="settings-field-error" role="alert">
            {passwordError}
          </small>
        )}
      </label>
      <label className="settings-checkbox">
        <input
          type="checkbox"
          checked={Boolean(draft.hidden)}
          disabled={saving}
          onChange={(event) => update({ hidden: event.target.checked })}
        />
        <span>Hidden network</span>
        {hiddenError && (
          <small className="settings-field-error" role="alert">
            {hiddenError}
          </small>
        )}
      </label>
      {section.error && !hasFieldValidationError(section) && (
        <p className="settings-inline-error" role="alert">
          {section.error}
        </p>
      )}
      {section.message && <p className="settings-success">{section.message}</p>}
      <EditorActions section={section} onDiscard={onDiscard} onSave={onSave} />
      <div className="settings-danger-zone">
        <p className="settings-danger-title">Remove Wi-Fi network</p>
        <p>
          Visitor phone handoff will skip Wi-Fi and continue to the collection
          QR.
        </p>
        {!confirmingRemoval ? (
          <button
            type="button"
            className="settings-danger-action"
            onClick={() => setConfirmingRemoval(true)}
            disabled={!hasSavedNetwork || section.status === "saving"}
          >
            Remove Wi-Fi network
          </button>
        ) : (
          <div className="settings-confirm-actions">
            <span>Remove this network?</span>
            <button
              type="button"
              className="settings-danger-action"
              onClick={() => {
                setConfirmingRemoval(false);
                onRemove();
              }}
              disabled={section.status === "saving"}
            >
              Confirm removal
            </button>
            <button
              type="button"
              className="settings-secondary-action"
              onClick={() => setConfirmingRemoval(false)}
            >
              Keep network
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function DiscogsEditor({ section, onChange, onSave, onDiscard, onRemove }) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const draft = section.draft ?? {
    username: "",
    token: "",
    hasToken: false,
    source: "none",
    canEdit: true,
  };
  const saving = section.status === "saving";
  const environmentManaged = draft.source === "environment";
  const hasSavedCredential = draft.source === "saved" && draft.hasToken;

  if (environmentManaged) {
    return (
      <section className="settings-editor" aria-labelledby="discogs-heading">
        <div className="settings-editor-heading">
          <div>
            <p className="settings-eyebrow">Discogs</p>
            <h2 id="discogs-heading">Environment-managed credentials</h2>
          </div>
          <Status section={section} />
        </div>
        <div className="settings-readonly-state">
          <strong>Ready for Discogs requests</strong>
          <span>
            Credentials are managed by the server environment and cannot be
            changed here.
          </span>
        </div>
      </section>
    );
  }

  function update(next) {
    onChange({ ...cloneValue(draft), ...next });
  }

  const usernameError = fieldValidationError(section, "username");
  const tokenError = fieldValidationError(section, "token");

  return (
    <section className="settings-editor" aria-labelledby="discogs-heading">
      <div className="settings-editor-heading">
        <div>
          <p className="settings-eyebrow">Discogs</p>
          <h2 id="discogs-heading">Discogs credentials</h2>
        </div>
        <Status section={section} />
      </div>
      <p className="settings-credential-status">
        {hasSavedCredential
          ? "Saved credentials — token on file. A blank token keeps it unchanged."
          : "Unconfigured — enter a username and personal access token to enable Sync."}
      </p>
      <label className="settings-field">
        <span>Username</span>
        <input
          type="text"
          value={draft.username}
          disabled={saving}
          aria-invalid={Boolean(usernameError)}
          onChange={(event) => update({ username: event.target.value })}
          autoComplete="username"
        />
        {usernameError && (
          <small className="settings-field-error" role="alert">
            {usernameError}
          </small>
        )}
      </label>
      <label className="settings-field">
        <span>Personal access token</span>
        <input
          type="password"
          value={draft.token ?? ""}
          disabled={saving}
          aria-invalid={Boolean(tokenError)}
          onChange={(event) => update({ token: event.target.value })}
          placeholder={hasSavedCredential ? "Leave blank to keep it" : ""}
          autoComplete="new-password"
        />
        <small>Saved tokens are never shown.</small>
        {tokenError && (
          <small className="settings-field-error" role="alert">
            {tokenError}
          </small>
        )}
      </label>
      {section.error && !hasFieldValidationError(section) && (
        <p className="settings-inline-error" role="alert">
          {section.error}
        </p>
      )}
      {section.message && <p className="settings-success">{section.message}</p>}
      <EditorActions
        section={section}
        onDiscard={onDiscard}
        onSave={onSave}
        disabled={!draft.canEdit}
      />
      <div className="settings-danger-zone">
        <p className="settings-danger-title">Remove saved credentials</p>
        <p>Sync with Discogs will become unavailable.</p>
        {!confirmingRemoval ? (
          <button
            type="button"
            className="settings-danger-action"
            onClick={() => setConfirmingRemoval(true)}
            disabled={!hasSavedCredential || section.status === "saving"}
          >
            Remove saved credentials
          </button>
        ) : (
          <div className="settings-confirm-actions">
            <span>Remove saved credentials?</span>
            <button
              type="button"
              className="settings-danger-action"
              onClick={() => {
                setConfirmingRemoval(false);
                onRemove();
              }}
              disabled={section.status === "saving"}
            >
              Confirm removal
            </button>
            <button
              type="button"
              className="settings-secondary-action"
              onClick={() => setConfirmingRemoval(false)}
            >
              Keep credentials
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

function DirtyNavigationPrompt({
  sections,
  onKeepEditing,
  onDiscard,
  saving = false,
}) {
  return (
    <div className="settings-warning-overlay" role="presentation">
      <div
        className="settings-warning-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-warning-title"
      >
        <h2 id="settings-warning-title">Unsaved changes</h2>
        <p>
          {saving
            ? "A Settings section is still saving. Wait for the save to finish before discarding or leaving."
            : `${sections.join(" and ")} ${
                sections.length === 1 ? "has" : "have"
              } unsaved changes.`}
        </p>
        <div className="settings-warning-actions">
          <button type="button" onClick={onKeepEditing}>
            Keep editing
          </button>
          <button
            type="button"
            className="settings-danger-action"
            onClick={onDiscard}
            disabled={saving}
            title={saving ? "Wait for the current save to finish." : undefined}
          >
            {saving ? "Saving…" : "Discard and leave"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsPage({
  settings,
  onSelectSection,
  onDraftChange,
  onSaveSection,
  onDiscardSection,
  onRemoveSection,
  onCancel,
  onKeepEditing,
  onDiscardAndLeave,
  onRetry,
}) {
  const active = settings.sections[settings.activeSection];
  const settingsSaving = isSettingsSaving({ settings });

  function renderEditor() {
    if (settings.activeSection === "visitorDisplay") {
      return (
        <VisitorDisplayEditor
          section={active}
          onChange={(draft) => onDraftChange("visitorDisplay", draft)}
          onSave={() => onSaveSection("visitorDisplay")}
          onDiscard={() => onDiscardSection("visitorDisplay")}
        />
      );
    }
    if (settings.activeSection === "wifi") {
      return (
        <WifiEditor
          section={active}
          onChange={(draft) => onDraftChange("wifi", draft)}
          onSave={() => onSaveSection("wifi")}
          onDiscard={() => onDiscardSection("wifi")}
          onRemove={() => onRemoveSection("wifi")}
        />
      );
    }
    return (
      <DiscogsEditor
        section={active}
        onChange={(draft) => onDraftChange("discogs", draft)}
        onSave={() => onSaveSection("discogs")}
        onDiscard={() => onDiscardSection("discogs")}
        onRemove={() => onRemoveSection("discogs")}
      />
    );
  }

  return (
    <main className="settings-page">
      <div className="settings-page-header">
        <div>
          <p className="settings-eyebrow">Vinyl Collection</p>
          <h1>Settings</h1>
        </div>
        <button
          type="button"
          className="settings-cancel"
          onClick={onCancel}
          disabled={settingsSaving}
          title={
            settingsSaving ? "Wait for the current save to finish." : undefined
          }
        >
          {settingsSaving ? "Saving…" : "Close"}
        </button>
      </div>
      {settings.loadError && (
        <div className="settings-load-error" role="alert">
          <span>{settings.loadError}</span>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}
      <div className="settings-layout">
        <SectionNav
          activeSection={settings.activeSection}
          sections={settings.sections}
          onSelect={onSelectSection}
          disabled={settingsSaving}
        />
        <div className="settings-editor-wrap">
          {settings.loading ? (
            <p className="settings-loading">Loading Settings…</p>
          ) : (
            renderEditor()
          )}
        </div>
      </div>
      {settings.navigationPrompt && (
        <DirtyNavigationPrompt
          sections={settings.navigationPrompt.sections}
          onKeepEditing={onKeepEditing}
          onDiscard={onDiscardAndLeave}
          saving={settingsSaving}
        />
      )}
    </main>
  );
}

export default SettingsPage;
