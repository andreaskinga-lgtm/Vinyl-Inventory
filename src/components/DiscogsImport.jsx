import { useState, useRef, useMemo, useCallback } from "react";
import { mapDiscogsRelease } from "../utils/discogsMapper";
import { isAdministratorSessionError } from "../utils/apiErrors.js";
import {
  beginSync,
  reducer,
  describePlan,
  emptyPlan,
} from "../utils/syncPlan";
import { canDismissDiscogsImport } from "../utils/discogsImportState.js";
import "./DiscogsImport.css";

const FIELD_LABELS = {
  coverUrl: "📷 Cover art",
  genre: "🎵 Genre",
  subGenres: "🎭 Styles",
  year: "📅 Year",
};

function formatFieldValue(field, value) {
  if (field === "subGenres") {
    return Array.isArray(value) && value.length > 0
      ? value.join(", ")
      : "(none)";
  }
  return value != null && value !== "" ? String(value) : "(none)";
}

function Thumb({ url, alt = "" }) {
  if (url) {
    return <img className="discogs-thumb" src={url} alt={alt} />;
  }
  return <div className="discogs-thumb discogs-thumb--empty">🎵</div>;
}

function responseError(body, fallback) {
  if (body?.error === "Discogs credentials are required") {
    return "Discogs credentials are required. Configure them in Settings before fetching.";
  }
  return body?.error || fallback;
}

function DiscogsImport({
  existingRecords,
  onImport,
  onClose,
  onConfigureCredentials,
  onSessionExpired,
  discogsConfig,
  discogsConfigLoading,
  discogsConfigError,
  writeError = null,
}) {
  // ── Phase "connect" state ──────────────────────────────────────────────
  const [phase, setPhase] = useState("connect");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null); // { page, totalPages }
  const username = discogsConfig?.username ?? "";
  const hasToken = discogsConfig?.hasToken ?? false;
  const source = discogsConfig?.source ?? "none";
  const configReady = discogsConfig !== null;

  // ── Phase "review" state ───────────────────────────────────────────────
  // The whole review — what this sync will do to the collection — lives in a
  // single plan value; everything derived from it is recomputed by
  // describePlan, never stored. Only genuine view state stays here.
  const [plan, setPlan] = useState(emptyPlan);
  const dispatch = useCallback(
    (intent) => setPlan((prev) => reducer(prev, intent)),
    [],
  );
  const view = useMemo(() => describePlan(plan), [plan]);

  const [expandedMatch, setExpandedMatch] = useState(null);
  // Manual match picker — matchingKey is a plan entry key ("r0", "r1", …)
  const [matchingKey, setMatchingKey] = useState(null);
  const [manualMatchSearch, setManualMatchSearch] = useState("");
  const [pickerAnchorY, setPickerAnchorY] = useState(null);
  const modalRef = useRef(null);
  const canDismiss = canDismissDiscogsImport({ loading, syncing });

  function handleClose() {
    if (!canDismiss) return;
    onClose();
  }

  // ── Helpers ─────────────────────────────────────────────────────────
  function fetchPage(page, per_page) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(per_page),
    });
    return fetch(`/api/discogs/collection?${params}`);
  }

  // ── Fetch all pages ──────────────────────────────────────────────────
  async function handleFetch(e) {
    e.preventDefault();
    if (!hasToken) {
      setError(
        "Discogs credentials are required. Configure them in Settings before fetching.",
      );
      return;
    }

    setLoading(true);
    setError(null);
    setProgress(null);

    try {
      // First page — reveals total page count
      const firstResp = await fetchPage(1, 100);
      if (!firstResp.ok) {
        const body = await firstResp.json().catch(() => ({}));
        if (isAdministratorSessionError(firstResp.status, body)) {
          onSessionExpired?.();
        }
        throw new Error(
          responseError(
            body,
            `HTTP ${firstResp.status}`,
          ),
        );
      }
      const firstData = await firstResp.json();
      const totalPages = firstData.pagination?.pages ?? 1;
      setProgress({ page: 1, totalPages });
      const allReleases = [...(firstData.releases ?? [])];

      for (let page = 2; page <= totalPages; page++) {
        setProgress({ page, totalPages });
        const resp = await fetchPage(page, 100);
        if (!resp.ok) {
          const body = await resp.json().catch(() => ({}));
          if (isAdministratorSessionError(resp.status, body)) {
            onSessionExpired?.();
          }
          throw new Error(
            responseError(body, `HTTP ${resp.status} on page ${page}`),
          );
        }
        const data = await resp.json();
        allReleases.push(...(data.releases ?? []));
        // Light throttle — avoids hammering Discogs on large collections
        if (page < totalPages) {
          await new Promise((r) => setTimeout(r, 250));
        }
      }

      // Everything above this line is the network; everything below is a pure
      // function of (allReleases, existingRecords).
      const mapped = allReleases.map(mapDiscogsRelease);
      setPlan(beginSync(mapped, existingRecords));
      setPhase("review");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  // ── Manual match ─────────────────────────────────────────────────────
  function openMatchPicker(key, buttonEl) {
    if (matchingKey === key) {
      setMatchingKey(null);
      setPickerAnchorY(null);
      setManualMatchSearch("");
      return;
    }
    setMatchingKey(key);
    setManualMatchSearch("");
    if (buttonEl && modalRef.current) {
      const btnRect = buttonEl.getBoundingClientRect();
      const modalRect = modalRef.current.getBoundingClientRect();
      const scrollTop = modalRef.current.scrollTop;
      setPickerAnchorY(btnRect.bottom - modalRect.top + scrollTop + 16);
    }
  }

  function closeMatchPicker() {
    setMatchingKey(null);
    setManualMatchSearch("");
  }

  function pickManualMatch(releaseKey, existingRecord) {
    // The plan decides whether this needs a reassignment confirmation.
    dispatch({ type: "matchManually", releaseKey, recordId: existingRecord.id });
    closeMatchPicker();
  }

  // ── Sync ───────────────────────────────────────────────────────────
  async function handleSync() {
    if (syncing) return;
    setSyncing(true);
    setError(null);
    try {
      await onImport(view.toImport, view.updates, view.deletions);
    } catch (errorValue) {
      setError(
        errorValue instanceof Error && errorValue.message
          ? errorValue.message
          : "Unable to save the imported collection.",
      );
    } finally {
      setSyncing(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div
      className="discogs-import-overlay"
      onClick={canDismiss ? handleClose : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Sync with Discogs"
      aria-busy={syncing}
    >
      <div
        className={`discogs-import-modal${phase === "review" ? " discogs-import-modal--wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
      >
        {/* Header */}
        <div className="discogs-import-header">
          <h3>Sync with Discogs</h3>
          <button
            className="discogs-import-close"
            onClick={handleClose}
            disabled={!canDismiss}
            aria-label="Close"
            title={
              canDismiss
                ? undefined
                : "Wait for the current Discogs save to finish."
            }
          >
            ✕
          </button>
        </div>

        {/* Steps */}
        <div className="discogs-import-steps">
          <span
            className={`discogs-step${phase === "connect" ? " discogs-step--active" : " discogs-step--done"}`}
          >
            1. Connect
          </span>
          <span className="discogs-step-sep">→</span>
          <span
            className={`discogs-step${phase === "review" ? " discogs-step--active" : ""}`}
          >
            2. Review
          </span>
        </div>

        {/* ── Phase A: Connect & Fetch ── */}
        {phase === "connect" && (
          <div className="discogs-connect-form">
            {discogsConfigLoading && (
              <p className="discogs-progress">Loading Discogs credentials…</p>
            )}

            {!discogsConfigLoading && configReady && source === "environment" && (
              <div className="discogs-credential-state discogs-credential-state--environment">
                <strong>Environment-managed credentials configured</strong>
                <span>
                  Discogs requests use the configured account{" "}
                  <strong>{username}</strong>.
                </span>
                <span className="discogs-field-hint">
                  These credentials are read-only in the app.
                </span>
              </div>
            )}

            {!discogsConfigLoading && configReady && source === "saved" && (
              <div className="discogs-credential-state discogs-credential-state--saved">
                <strong>Saved credentials configured</strong>
                <span>
                  Discogs requests use the saved account{" "}
                  <strong>{username}</strong>.
                </span>
                <span className="discogs-field-hint">
                  A saved token is on file and is never shown in Sync.
                </span>
              </div>
            )}

            {!discogsConfigLoading && configReady && source === "none" && (
              <div className="discogs-credential-state discogs-credential-state--none">
                <strong>Discogs configuration required</strong>
                <span>
                  An administrator must configure a username and personal
                  access token in Settings before Sync can connect.
                </span>
                <button
                  type="button"
                  className="primary-btn"
                  onClick={onConfigureCredentials}
                  disabled={loading}
                >
                  Open Discogs settings
                </button>
              </div>
            )}

            {(error || discogsConfigError) && (
              <p className="discogs-error">{error || discogsConfigError}</p>
            )}
            {loading && (
              <p className="discogs-progress">
                {progress
                  ? `Fetching page ${progress.page} of ${progress.totalPages}…`
                  : "Connecting…"}
              </p>
            )}

            <form className="discogs-fetch-form" onSubmit={handleFetch}>
              <div className="discogs-import-actions">
                <button
                  type="button"
                  className="cancel-btn"
                  onClick={handleClose}
                  disabled={!canDismiss}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={loading || !configReady || !hasToken}
                >
                  {loading ? "Fetching…" : "Fetch Collection"}
                </button>
              </div>
            </form>

            <p className="discogs-attribution">
              This application uses Discogs’ API but is not affiliated with,
              sponsored or endorsed by Discogs. “Discogs” is a trademark of Zink
              Media, LLC.
            </p>
          </div>
        )}

        {/* ── Phase B: Review & Sync ── */}
        {phase === "review" &&
          (() => {
            const searchLower = manualMatchSearch.toLowerCase();
            const filteredExisting = manualMatchSearch
              ? view.pickableExisting.filter(
                  (e) =>
                    e.artist.toLowerCase().includes(searchLower) ||
                    e.title.toLowerCase().includes(searchLower),
                )
              : view.pickableExisting;

            return (
              <>
                {/* Floating match picker — rendered at modal level, above all lists */}
                {matchingKey !== null && pickerAnchorY !== null && (
                  <div
                    className="discogs-match-picker"
                    style={{ top: pickerAnchorY }}
                  >
                    <input
                      className="discogs-match-picker-search"
                      type="search"
                      autoFocus
                      placeholder="Search your collection…"
                      value={manualMatchSearch}
                      onChange={(e) => setManualMatchSearch(e.target.value)}
                    />
                    <div className="discogs-match-picker-list">
                      {filteredExisting.length === 0 ? (
                        <p className="discogs-match-picker-empty">
                          {manualMatchSearch
                            ? "No records matched your search."
                            : "All existing records are already matched."}
                        </p>
                      ) : (
                        filteredExisting.map((existing) => (
                          <button
                            key={existing.id}
                            className="discogs-match-picker-row"
                            onClick={() =>
                              pickManualMatch(matchingKey, existing)
                            }
                          >
                            <Thumb
                              url={existing.coverUrl}
                              alt={existing.title}
                            />
                            <div className="discogs-record-info">
                              <span className="discogs-record-artist">
                                {existing.artist}
                              </span>
                              <span className="discogs-record-title">
                                {existing.title}
                              </span>
                            </div>
                            {existing.discogsId != null && (
                              <span
                                className="discogs-meta-tag"
                                title="Already linked to a Discogs release"
                              >
                                🔗 linked
                              </span>
                            )}
                            {existing.year && (
                              <span className="discogs-meta-tag">
                                {existing.year}
                              </span>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {/* Reassign confirmation */}
                {view.pendingReassign && (
                  <div
                    className="discogs-reassign-overlay"
                    onClick={() => dispatch({ type: "cancelReassignment" })}
                  >
                    <div
                      className="discogs-reassign-dialog"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p>
                        This copy is already linked to a different release
                        (ID: {view.pendingReassign.existingRecord.discogsId}) —
                        reassign anyway?
                      </p>
                      <div className="discogs-import-actions">
                        <button
                          type="button"
                          className="cancel-btn"
                          onClick={() =>
                            dispatch({ type: "cancelReassignment" })
                          }
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={() =>
                            dispatch({ type: "confirmReassignment" })
                          }
                        >
                          Reassign anyway
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* New Records */}
                {view.newEntries.length > 0 && (
                  <section className="discogs-section">
                    <div className="discogs-section-header">
                      <label className="discogs-section-title">
                        <input
                          type="checkbox"
                          checked={view.allNewChecked}
                          onChange={(e) =>
                            dispatch({
                              type: "toggleAllImports",
                              bucket: "new",
                              on: e.target.checked,
                            })
                          }
                        />
                        New Records ({view.newEntries.length})
                      </label>
                      <span className="discogs-section-sub">
                        These will be added to your collection
                      </span>
                    </div>
                    <div className="discogs-record-list">
                      {view.newEntries.map((entry) => {
                        const record = entry.discogs;
                        const key = entry.key;
                        const checked = entry.selected;
                        const isPickerOpen = matchingKey === key;
                        const claimedSibling = entry.claimedSibling;

                        return (
                          <div
                            key={key}
                            className={`discogs-record-row discogs-record-row--new-outer${checked ? "" : " discogs-record-row--unchecked"}`}
                          >
                            {/* Main row */}
                            <div className="discogs-record-row-main discogs-record-row-main--new">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  dispatch({
                                    type: "toggleImport",
                                    releaseKey: key,
                                  })
                                }
                              />
                              <Thumb url={record.coverUrl} alt={record.title} />
                              <div className="discogs-record-info">
                                <span className="discogs-record-artist">
                                  {record.artist}
                                </span>
                                <span className="discogs-record-title">
                                  {record.title}
                                </span>
                              </div>
                              <div className="discogs-record-meta">
                                {record.year && (
                                  <span className="discogs-meta-tag">
                                    {record.year}
                                  </span>
                                )}
                                {record.genre && (
                                  <span className="discogs-meta-tag">
                                    {record.genre}
                                  </span>
                                )}
                              </div>
                              <button
                                className={`discogs-manual-match-btn${isPickerOpen ? " discogs-manual-match-btn--open" : ""}`}
                                title="Match to an existing record in your collection"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openMatchPicker(key, e.currentTarget);
                                }}
                              >
                                {isPickerOpen ? "✕" : "Match"}
                              </button>
                            </div>
                            {claimedSibling && (
                              <div className="discogs-pressing-hint">
                                <Thumb
                                  url={claimedSibling.coverUrl}
                                  alt={claimedSibling.title}
                                />
                                <span>
                                  Similar to existing pressing:{" "}
                                  {claimedSibling.artist} –{" "}
                                  {claimedSibling.title}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Ambiguous Records */}
                {view.ambiguousEntries.length > 0 && (
                  <section className="discogs-section discogs-section--ambiguous">
                    <div className="discogs-section-header">
                      <label className="discogs-section-title">
                        <input
                          type="checkbox"
                          checked={view.allAmbiguousChecked}
                          onChange={(e) =>
                            dispatch({
                              type: "toggleAllImports",
                              bucket: "ambiguous",
                              on: e.target.checked,
                            })
                          }
                        />
                        Needs Manual Match ({view.ambiguousEntries.length})
                      </label>
                      <span className="discogs-section-sub">
                        Multiple existing records share this artist/title —
                        pick the right one below, or import as a new record
                      </span>
                    </div>
                    <div className="discogs-record-list">
                      {view.ambiguousEntries.map((entry) => {
                        const record = entry.discogs;
                        const key = entry.key;
                        const checked = entry.selected;
                        const isPickerOpen = matchingKey === key;

                        return (
                          <div
                            key={key}
                            className={`discogs-record-row discogs-record-row--new-outer${checked ? "" : " discogs-record-row--unchecked"}`}
                          >
                            <div className="discogs-record-row-main discogs-record-row-main--new">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  dispatch({
                                    type: "toggleImport",
                                    releaseKey: key,
                                  })
                                }
                              />
                              <Thumb url={record.coverUrl} alt={record.title} />
                              <div className="discogs-record-info">
                                <span className="discogs-record-artist">
                                  {record.artist}
                                </span>
                                <span className="discogs-record-title">
                                  {record.title}
                                </span>
                              </div>
                              <div className="discogs-record-meta">
                                {record.year && (
                                  <span className="discogs-meta-tag">
                                    {record.year}
                                  </span>
                                )}
                                {record.genre && (
                                  <span className="discogs-meta-tag">
                                    {record.genre}
                                  </span>
                                )}
                              </div>
                              <button
                                className={`discogs-manual-match-btn${isPickerOpen ? " discogs-manual-match-btn--open" : ""}`}
                                title="Match to an existing record in your collection"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openMatchPicker(key, e.currentTarget);
                                }}
                              >
                                {isPickerOpen ? "✕" : "Match"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {/* Matched Records */}
                {view.matches.length > 0 && (
                  <section className="discogs-section">
                    <div className="discogs-section-header">
                      <label className="discogs-section-title">
                        <input
                          type="checkbox"
                          checked={view.allMatchesEnabled}
                          onChange={(e) =>
                            dispatch({
                              type: "toggleAllImports",
                              bucket: "matched",
                              on: e.target.checked,
                            })
                          }
                        />
                        Matched Records ({view.matches.length})
                      </label>
                      <span className="discogs-section-sub">
                        Already in your collection — Discogs data will enrich
                        them
                      </span>
                    </div>
                    <div className="discogs-record-list">
                      {view.matches.map((m) => {
                        const isExpanded = expandedMatch === m.existing.id;
                        const userFieldKeys = Object.keys(m.fields);

                        return (
                          <div
                            key={m.existing.id}
                            className={`discogs-record-row discogs-record-row--match${m.enabled ? "" : " discogs-record-row--unchecked"}`}
                          >
                            {/* Main row */}
                            <div
                              className="discogs-record-row-main"
                              onClick={() =>
                                setExpandedMatch(
                                  isExpanded ? null : m.existing.id,
                                )
                              }
                            >
                              <input
                                type="checkbox"
                                checked={m.enabled}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  dispatch({
                                    type: "setMatchEnabled",
                                    recordId: m.existing.id,
                                    on: e.target.checked,
                                  });
                                }}
                              />
                              <Thumb
                                url={m.existing.coverUrl || m.discogs.coverUrl}
                                alt={m.existing.title}
                              />
                              <div className="discogs-record-info">
                                <span className="discogs-record-artist">
                                  {m.existing.artist}
                                </span>
                                <span className="discogs-record-title">
                                  {m.existing.title}
                                </span>
                              </div>
                              <div className="discogs-record-badges">
                                {userFieldKeys.length > 0 ? (
                                  userFieldKeys.map((field) => (
                                    <span
                                      key={field}
                                      className={`discogs-badge${m.fields[field] ? "" : " discogs-badge--off"}`}
                                    >
                                      {FIELD_LABELS[field]}
                                    </span>
                                  ))
                                ) : (
                                  <span className="discogs-badge discogs-badge--link">
                                    🔗 Link
                                  </span>
                                )}
                              </div>
                              <span className="discogs-expand-btn">
                                {isExpanded ? "▲" : "▼"}
                              </span>
                            </div>

                            {/* Expanded detail */}
                            {isExpanded && (
                              <div className="discogs-match-details">
                                {userFieldKeys.length === 0 ? (
                                  <p className="discogs-link-note">
                                    This record will be linked to Discogs (ID:{" "}
                                    {m.fieldsToUpdate.discogsId}). No missing
                                    fields to fill in.
                                  </p>
                                ) : (
                                  userFieldKeys.map((field) => (
                                    <div
                                      key={field}
                                      className="discogs-field-diff"
                                    >
                                      <label>
                                        <input
                                          type="checkbox"
                                          checked={m.fields[field]}
                                          onChange={(e) =>
                                            dispatch({
                                              type: "setFieldEnabled",
                                              recordId: m.existing.id,
                                              field,
                                              on: e.target.checked,
                                            })
                                          }
                                        />
                                        {FIELD_LABELS[field]}
                                      </label>
                                      <div className="discogs-diff-values">
                                        <span className="discogs-diff-current">
                                          {formatFieldValue(
                                            field,
                                            m.existing[field],
                                          )}
                                        </span>
                                        <span className="discogs-diff-arrow">
                                          →
                                        </span>
                                        <span className="discogs-diff-new">
                                          {formatFieldValue(
                                            field,
                                            m.fieldsToUpdate[field],
                                          )}
                                        </span>
                                      </div>
                                    </div>
                                  ))
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {view.isEmpty && (
                  <div className="discogs-empty">
                    <p>
                      No new records found to sync in this Discogs collection.
                    </p>
                  </div>
                )}

                {/* Delete unmatched toggle */}
                <label className="discogs-delete-enable">
                  <input
                    type="checkbox"
                    checked={view.deletionsEnabled}
                    onChange={(e) =>
                      dispatch({
                        type: "setDeletionsEnabled",
                        on: e.target.checked,
                      })
                    }
                  />
                  <span>Also delete records not found in Discogs</span>
                  {view.unmatched.length > 0 && (
                    <span className="discogs-delete-enable-count">
                      ({view.unmatched.length} record
                      {view.unmatched.length !== 1 ? "s" : ""})
                    </span>
                  )}
                </label>

                {/* Not on Discogs */}
                {view.deletionsEnabled && view.unmatched.length > 0 && (
                  <section className="discogs-section discogs-section--danger">
                    <div className="discogs-section-header">
                      <label className="discogs-section-title">
                        <input
                          type="checkbox"
                          checked={view.allDeletionsChecked}
                          onChange={(e) =>
                            dispatch({
                              type: "toggleAllImports",
                              bucket: "deletions",
                              on: e.target.checked,
                            })
                          }
                        />
                        Not on Discogs ({view.unmatched.length})
                      </label>
                      <span className="discogs-section-sub">
                        Checked records will be permanently deleted from your
                        collection
                      </span>
                    </div>
                    <div className="discogs-record-list">
                      {view.unmatched.map((record) => {
                        const checked = view.selectedDeletions.has(record.id);
                        return (
                          <div
                            key={record.id}
                            className={`discogs-record-row discogs-record-row--danger${
                              checked ? "" : " discogs-record-row--unchecked"
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                dispatch({
                                  type: "toggleDeletion",
                                  recordId: record.id,
                                })
                              }
                            />
                            <Thumb url={record.coverUrl} alt={record.title} />
                            <div className="discogs-record-info">
                              <span className="discogs-record-artist">
                                {record.artist}
                              </span>
                              <span className="discogs-record-title">
                                {record.title}
                              </span>
                            </div>
                            <div className="discogs-record-meta">
                              {record.year && (
                                <span className="discogs-meta-tag">
                                  {record.year}
                                </span>
                              )}
                              {record.genre && (
                                <span className="discogs-meta-tag">
                                  {record.genre}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {view.deletionsEnabled && view.unmatched.length === 0 && (
                  <div className="discogs-empty">
                    <p>All records in your collection have a Discogs match.</p>
                  </div>
                )}

                {/* Footer */}
                <div className="discogs-import-footer">
                  <span className="discogs-summary">{view.summary}</span>
                  {(writeError || error) && (
                    <p className="discogs-error" role="alert">
                      {writeError || error}
                    </p>
                  )}
                  <div className="discogs-import-actions">
                    <button
                      type="button"
                      className="cancel-btn"
                      onClick={handleClose}
                      disabled={!canDismiss}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={handleSync}
                      disabled={
                        syncing ||
                        view.counts.imports === 0 &&
                        view.counts.updates === 0 &&
                        view.counts.deletions === 0
                      }
                    >
                      {syncing ? "Saving…" : "Sync"}
                    </button>
                  </div>
                </div>

                <p className="discogs-attribution">
                  Data provided by{" "}
                  <a
                    href="https://www.discogs.com"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Discogs
                  </a>
                </p>
              </>
            );
          })()}
      </div>
    </div>
  );
}

export default DiscogsImport;
