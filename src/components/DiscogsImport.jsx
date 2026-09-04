import { useState, useEffect, useRef } from "react";
import {
  mapDiscogsRelease,
  findMatches,
  computeFieldsToUpdate,
  normalizeStr,
} from "../utils/discogsMapper";
import "./DiscogsImport.css";

const SAVED_TOKEN_PLACEHOLDER = "••••••••";

const FIELD_LABELS = {
  coverUrl: "📷 Cover art",
  genre: "🎵 Genre",
  subGenres: "🎭 Styles",
  year: "📅 Year",
};

/** User-facing field keys (not discogsId, which is applied silently). */
const USER_FIELDS = ["coverUrl", "genre", "subGenres", "year"];

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

/**
 * Finds an existing claimed (discogsId != null) record sharing normalized
 * artist+title with a "new" release — used only to render an informational
 * hint explaining why a release that looks like a duplicate showed up as new.
 */
function findClaimedSibling(discogs, existingRecords) {
  const key = normalizeStr(discogs.artist) + "\x00" + normalizeStr(discogs.title);
  if (key === "\x00") return null;
  return (
    existingRecords.find(
      (e) =>
        e.discogsId != null &&
        normalizeStr(e.artist) + "\x00" + normalizeStr(e.title) === key,
    ) ?? null
  );
}

function DiscogsImport({ existingRecords, onImport, onClose }) {
  // ── Phase "connect" state ──────────────────────────────────────────────
  const [phase, setPhase] = useState("connect");
  const [username, setUsername] = useState("");
  const [token, setToken] = useState("");
  const [remember, setRemember] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [progress, setProgress] = useState(null); // { page, totalPages }

  // ── Phase "review" state ───────────────────────────────────────────────
  const [newRecords, setNewRecords] = useState([]);
  const [matchedRecords, setMatchedRecords] = useState([]);
  const [ambiguousRecords, setAmbiguousRecords] = useState([]);
  // selectedNew: Set of discogsId (string) keys
  const [selectedNew, setSelectedNew] = useState(new Set());
  // selectedAmbiguous: Set of discogsId (string) keys — starts empty; ambiguous
  // records must never be silently imported, so importing one requires the
  // user to explicitly check it (or resolve it via the manual match picker).
  const [selectedAmbiguous, setSelectedAmbiguous] = useState(new Set());
  // matchSelections: { [existingId]: { enabled: bool, fields: { coverUrl?: bool, … } } }
  const [matchSelections, setMatchSelections] = useState({});
  const [expandedMatch, setExpandedMatch] = useState(null);
  // Manual match picker — matchingKey is namespaced "new:<key>" or "amb:<key>"
  const [matchingKey, setMatchingKey] = useState(null);
  const [manualMatchSearch, setManualMatchSearch] = useState("");
  const [pickerAnchorY, setPickerAnchorY] = useState(null);
  // Reassignment confirmation: set when the user picks an existing record
  // that's already claimed by a different discogsId.
  const [pendingReassign, setPendingReassign] = useState(null);
  const modalRef = useRef(null);
  // Delete unmatched
  const [enableDeleteUnmatched, setEnableDeleteUnmatched] = useState(false);
  const [selectedForDeletion, setSelectedForDeletion] = useState(new Set());
  // Full set of discogsIds present in the fetched collection (including already-linked records)
  const [fetchedDiscogsIds, setFetchedDiscogsIds] = useState(new Set());

  // Pre-fill saved config on mount
  useEffect(() => {
    fetch("/api/discogs-config")
      .then((r) => r.json())
      .then((data) => {
        if (data.username) setUsername(data.username);
        if (data.hasToken) {
          setToken(SAVED_TOKEN_PLACEHOLDER);
          setRemember(true);
        }
      })
      .catch(() => {});
  }, []);

  // ── Helpers ─────────────────────────────────────────────────────────
  function newRecordKey(record, index) {
    return record.discogsId != null ? String(record.discogsId) : `idx-${index}`;
  }

  /** Namespaced key for the manual-match picker, shared by new & ambiguous records. */
  function pickerKey(bucket, record, index) {
    return `${bucket}:${newRecordKey(record, index)}`;
  }

  function fetchPage(page, per_page) {
    const params = new URLSearchParams({
      username: username.trim(),
      page: String(page),
      per_page: String(per_page),
    });
    // Pass token inline when the user has typed a real one (not the placeholder)
    const activeToken = token.trim();
    if (activeToken && activeToken !== SAVED_TOKEN_PLACEHOLDER) {
      params.set("token", activeToken);
    }
    return fetch(`/api/discogs/collection?${params}`);
  }

  // ── Fetch all pages ──────────────────────────────────────────────────
  async function handleFetch(e) {
    e.preventDefault();
    if (!username.trim()) {
      setError("Username is required.");
      return;
    }
    const activeToken = token.trim();
    if (!activeToken) {
      setError("Personal access token is required.");
      return;
    }

    // Save config if "Remember" is checked and user entered a real token
    if (remember && activeToken !== SAVED_TOKEN_PLACEHOLDER) {
      try {
        await fetch("/api/discogs-config", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: username.trim(),
            token: activeToken,
          }),
        });
      } catch {
        // Non-fatal — we can still try to fetch
      }
    }

    setLoading(true);
    setError(null);
    setProgress(null);

    try {
      // First page — reveals total page count
      const firstResp = await fetchPage(1, 100);
      if (!firstResp.ok) {
        const body = await firstResp.json().catch(() => ({}));
        throw new Error(
          body.error ||
            (firstResp.status === 401
              ? "Invalid token or private collection."
              : `HTTP ${firstResp.status}`),
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
          throw new Error(body.error || `HTTP ${resp.status} on page ${page}`);
        }
        const data = await resp.json();
        allReleases.push(...(data.releases ?? []));
        // Light throttle — avoids hammering Discogs on large collections
        if (page < totalPages) {
          await new Promise((r) => setTimeout(r, 250));
        }
      }

      // Map and partition
      const mapped = allReleases.map(mapDiscogsRelease);
      const {
        newRecords: nr,
        matchedRecords: mr,
        ambiguousRecords: ar,
      } = findMatches(mapped, existingRecords);

      // Store every discogsId from the fetched collection so we can detect
      // local records whose Discogs entry has since been removed.
      const allFetchedIds = new Set(
        mapped.map((r) => r.discogsId).filter(Boolean),
      );

      // Initialise selection state for new records
      const initSelectedNew = new Set(nr.map((r, i) => newRecordKey(r, i)));

      // Initialise per-field toggles for matched records
      const initMatchSels = {};
      for (const m of mr) {
        const fields = {};
        for (const f of USER_FIELDS) {
          if (f in m.fieldsToUpdate) fields[f] = true;
        }
        initMatchSels[m.existing.id] = { enabled: true, fields };
      }

      setNewRecords(nr);
      setMatchedRecords(mr);
      setAmbiguousRecords(ar);
      setSelectedNew(initSelectedNew);
      // Ambiguous records start unselected — see selectedAmbiguous comment above.
      setSelectedAmbiguous(new Set());
      setMatchSelections(initMatchSels);
      setFetchedDiscogsIds(allFetchedIds);
      setPhase("review");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  // ── Review interactions ──────────────────────────────────────────────
  function toggleNew(key) {
    setSelectedNew((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleAllNew(checked) {
    setSelectedNew(
      checked
        ? new Set(newRecords.map((r, i) => newRecordKey(r, i)))
        : new Set(),
    );
  }

  function toggleAmbiguous(key) {
    setSelectedAmbiguous((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function toggleAllAmbiguous(checked) {
    setSelectedAmbiguous(
      checked
        ? new Set(ambiguousRecords.map((r, i) => newRecordKey(r, i)))
        : new Set(),
    );
  }

  function toggleMatch(existingId, checked) {
    setMatchSelections((prev) => ({
      ...prev,
      [existingId]: { ...prev[existingId], enabled: checked },
    }));
  }

  function toggleAllMatches(checked) {
    setMatchSelections((prev) => {
      const next = {};
      for (const [id, sel] of Object.entries(prev)) {
        next[id] = { ...sel, enabled: checked };
      }
      return next;
    });
  }

  function toggleMatchField(existingId, field, checked) {
    setMatchSelections((prev) => ({
      ...prev,
      [existingId]: {
        ...prev[existingId],
        fields: { ...prev[existingId].fields, [field]: checked },
      },
    }));
  }

  // ── Manual match ─────────────────────────────────────────────────────
  // `key` is namespaced ("new:<key>" or "amb:<key>") so the same picker UI
  // can resolve either a new record or an ambiguous one.
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

  /** Resolves a namespaced picker key to its source discogs record. */
  function findPickerSourceRecord(key) {
    const [bucket, ...rest] = key.split(":");
    const rawKey = rest.join(":");
    const list = bucket === "amb" ? ambiguousRecords : newRecords;
    const idx = list.findIndex((r, i) => newRecordKey(r, i) === rawKey);
    return idx === -1 ? null : { bucket, idx, discogsRecord: list[idx] };
  }

  function pickManualMatch(key, existingRecord) {
    // Reassigning a record that's already claimed by a *different* release
    // needs explicit confirmation before proceeding.
    const source = findPickerSourceRecord(key);
    if (!source) return;
    if (
      existingRecord.discogsId != null &&
      existingRecord.discogsId !== source.discogsRecord.discogsId
    ) {
      setPendingReassign({ key, existingRecord });
      return;
    }
    handleManualMatch(key, existingRecord);
  }

  function handleManualMatch(key, existingRecord) {
    const source = findPickerSourceRecord(key);
    if (!source) return;
    const { bucket, idx, discogsRecord } = source;
    const fieldsToUpdate = computeFieldsToUpdate(discogsRecord, existingRecord);

    // Build per-field toggle state for the new match entry
    const fields = {};
    for (const f of USER_FIELDS) {
      if (f in fieldsToUpdate) fields[f] = true;
    }

    setMatchedRecords((prev) => [
      ...prev,
      { discogs: discogsRecord, existing: existingRecord, fieldsToUpdate },
    ]);
    setMatchSelections((prev) => ({
      ...prev,
      [existingRecord.id]: { enabled: true, fields },
    }));
    if (bucket === "amb") {
      setAmbiguousRecords((prev) => prev.filter((_, i) => i !== idx));
      setSelectedAmbiguous((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    } else {
      setNewRecords((prev) => prev.filter((_, i) => i !== idx));
      setSelectedNew((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
    setMatchingKey(null);
    setManualMatchSearch("");
    setPendingReassign(null);
  }

  function confirmReassign() {
    if (!pendingReassign) return;
    handleManualMatch(pendingReassign.key, pendingReassign.existingRecord);
  }

  function cancelReassign() {
    setPendingReassign(null);
  }

  // ── Delete unmatched ──────────────────────────────────────────────
  function toggleEnableDeleteUnmatched(checked, unmatchedList) {
    setEnableDeleteUnmatched(checked);
    setSelectedForDeletion(
      checked ? new Set(unmatchedList.map((r) => r.id)) : new Set(),
    );
  }

  function toggleDeletion(id) {
    setSelectedForDeletion((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAllDeletions(checked, unmatchedList) {
    setSelectedForDeletion(
      checked ? new Set(unmatchedList.map((r) => r.id)) : new Set(),
    );
  }

  // ── Sync ───────────────────────────────────────────────────────────
  function handleSync(unmatchedList) {
    const toImport = [
      ...newRecords.filter((r, i) => selectedNew.has(newRecordKey(r, i))),
      ...ambiguousRecords.filter((r, i) =>
        selectedAmbiguous.has(newRecordKey(r, i)),
      ),
    ];

    const updates = matchedRecords
      .filter((m) => matchSelections[m.existing.id]?.enabled)
      .map((m) => {
        const sel = matchSelections[m.existing.id];
        const fieldsToApply = { discogsId: m.fieldsToUpdate.discogsId };
        for (const [field, on] of Object.entries(sel.fields)) {
          if (on && field in m.fieldsToUpdate) {
            fieldsToApply[field] = m.fieldsToUpdate[field];
          }
        }
        return { existingId: m.existing.id, fields: fieldsToApply };
      });

    const toDelete = enableDeleteUnmatched
      ? unmatchedList
          .filter((r) => selectedForDeletion.has(r.id))
          .map((r) => r.id)
      : [];

    onImport(toImport, updates, toDelete);
  }

  // ── Derived counts ───────────────────────────────────────────────────
  // Records in the current collection that have no Discogs counterpart.
  // Excludes records being enriched in this import (matchedRecords).
  // A record with a discogsId is only excluded if that ID is confirmed present
  // in the fetched collection — if it was removed from Discogs/the user's
  // collection it remains eligible for deletion.
  const matchedExistingIds = new Set(matchedRecords.map((m) => m.existing.id));
  const unmatchedExisting = existingRecords.filter(
    (e) =>
      !matchedExistingIds.has(e.id) &&
      (!e.discogsId || !fetchedDiscogsIds.has(e.discogsId)),
  );

  const importCount = selectedNew.size + selectedAmbiguous.size;
  const updateCount = matchedRecords.filter(
    (m) => matchSelections[m.existing.id]?.enabled,
  ).length;
  const deleteCount = enableDeleteUnmatched ? selectedForDeletion.size : 0;
  const allNewChecked =
    newRecords.length > 0 && selectedNew.size === newRecords.length;
  const allAmbiguousChecked =
    ambiguousRecords.length > 0 &&
    selectedAmbiguous.size === ambiguousRecords.length;
  const allMatchesEnabled =
    matchedRecords.length > 0 &&
    Object.values(matchSelections).every((s) => s.enabled);

  function summaryText() {
    const parts = [];
    if (importCount > 0)
      parts.push(
        `Import ${importCount} new record${importCount !== 1 ? "s" : ""}`,
      );
    if (updateCount > 0)
      parts.push(
        `update ${updateCount} existing record${updateCount !== 1 ? "s" : ""}`,
      );
    if (deleteCount > 0)
      parts.push(`delete ${deleteCount} record${deleteCount !== 1 ? "s" : ""}`);
    return parts.length > 0 ? parts.join(", ") : "No changes selected";
  }

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div
      className="discogs-import-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Sync with Discogs"
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
            onClick={onClose}
            aria-label="Close"
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
          <form className="discogs-connect-form" onSubmit={handleFetch}>
            <div className="discogs-field">
              <span className="discogs-field-label">Discogs username</span>
              <input
                type="text"
                value={username}
                placeholder="your_username"
                autoComplete="username"
                autoFocus
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="discogs-field">
              <span className="discogs-field-label">Personal access token</span>
              <input
                type="password"
                value={token}
                placeholder="Paste your token here"
                autoComplete="new-password"
                onChange={(e) => setToken(e.target.value)}
              />
              <span className="discogs-field-hint">
                Generate a token at{" "}
                <a
                  href="https://www.discogs.com/settings/developers"
                  target="_blank"
                  rel="noreferrer"
                >
                  discogs.com/settings/developers
                </a>
              </span>
            </div>

            <label className="discogs-remember">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              Remember username and token
            </label>

            {error && <p className="discogs-error">{error}</p>}
            {loading && (
              <p className="discogs-progress">
                {progress
                  ? `Fetching page ${progress.page} of ${progress.totalPages}…`
                  : "Connecting…"}
              </p>
            )}

            <div className="discogs-import-actions">
              <button
                type="button"
                className="cancel-btn"
                onClick={onClose}
                disabled={loading}
              >
                Cancel
              </button>
              <button type="submit" className="primary-btn" disabled={loading}>
                {loading ? "Fetching…" : "Fetch Collection"}
              </button>
            </div>

            <p className="discogs-attribution">
              This application uses Discogs’ API but is not affiliated with,
              sponsored or endorsed by Discogs. “Discogs” is a trademark of Zink
              Media, LLC.
            </p>
          </form>
        )}

        {/* ── Phase B: Review & Sync ── */}
        {phase === "review" &&
          (() => {
            const alreadyMatchedIds = new Set(
              matchedRecords.map((m) => m.existing.id),
            );
            const pickableExisting = existingRecords.filter(
              (e) => !alreadyMatchedIds.has(e.id),
            );
            const searchLower = manualMatchSearch.toLowerCase();
            const filteredExisting = manualMatchSearch
              ? pickableExisting.filter(
                  (e) =>
                    e.artist.toLowerCase().includes(searchLower) ||
                    e.title.toLowerCase().includes(searchLower),
                )
              : pickableExisting;

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
                {pendingReassign && (
                  <div
                    className="discogs-reassign-overlay"
                    onClick={cancelReassign}
                  >
                    <div
                      className="discogs-reassign-dialog"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <p>
                        This copy is already linked to a different release
                        (ID: {pendingReassign.existingRecord.discogsId}) —
                        reassign anyway?
                      </p>
                      <div className="discogs-import-actions">
                        <button
                          type="button"
                          className="cancel-btn"
                          onClick={cancelReassign}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={confirmReassign}
                        >
                          Reassign anyway
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* New Records */}
                {newRecords.length > 0 && (
                  <section className="discogs-section">
                    <div className="discogs-section-header">
                      <label className="discogs-section-title">
                        <input
                          type="checkbox"
                          checked={allNewChecked}
                          onChange={(e) => toggleAllNew(e.target.checked)}
                        />
                        New Records ({newRecords.length})
                      </label>
                      <span className="discogs-section-sub">
                        These will be added to your collection
                      </span>
                    </div>
                    <div className="discogs-record-list">
                      {newRecords.map((record, i) => {
                        const rawKey = newRecordKey(record, i);
                        const key = pickerKey("new", record, i);
                        const checked = selectedNew.has(rawKey);
                        const isPickerOpen = matchingKey === key;
                        const claimedSibling = findClaimedSibling(
                          record,
                          existingRecords,
                        );

                        return (
                          <div
                            key={rawKey}
                            className={`discogs-record-row discogs-record-row--new-outer${checked ? "" : " discogs-record-row--unchecked"}`}
                          >
                            {/* Main row */}
                            <div className="discogs-record-row-main discogs-record-row-main--new">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleNew(rawKey)}
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
                {ambiguousRecords.length > 0 && (
                  <section className="discogs-section discogs-section--ambiguous">
                    <div className="discogs-section-header">
                      <label className="discogs-section-title">
                        <input
                          type="checkbox"
                          checked={allAmbiguousChecked}
                          onChange={(e) =>
                            toggleAllAmbiguous(e.target.checked)
                          }
                        />
                        Needs Manual Match ({ambiguousRecords.length})
                      </label>
                      <span className="discogs-section-sub">
                        Multiple existing records share this artist/title —
                        pick the right one below, or import as a new record
                      </span>
                    </div>
                    <div className="discogs-record-list">
                      {ambiguousRecords.map((record, i) => {
                        const rawKey = newRecordKey(record, i);
                        const key = pickerKey("amb", record, i);
                        const checked = selectedAmbiguous.has(rawKey);
                        const isPickerOpen = matchingKey === key;

                        return (
                          <div
                            key={rawKey}
                            className={`discogs-record-row discogs-record-row--new-outer${checked ? "" : " discogs-record-row--unchecked"}`}
                          >
                            <div className="discogs-record-row-main discogs-record-row-main--new">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleAmbiguous(rawKey)}
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
                {matchedRecords.length > 0 && (
                  <section className="discogs-section">
                    <div className="discogs-section-header">
                      <label className="discogs-section-title">
                        <input
                          type="checkbox"
                          checked={allMatchesEnabled}
                          onChange={(e) => toggleAllMatches(e.target.checked)}
                        />
                        Matched Records ({matchedRecords.length})
                      </label>
                      <span className="discogs-section-sub">
                        Already in your collection — Discogs data will enrich
                        them
                      </span>
                    </div>
                    <div className="discogs-record-list">
                      {matchedRecords.map((m) => {
                        const sel = matchSelections[m.existing.id] ?? {
                          enabled: true,
                          fields: {},
                        };
                        const isExpanded = expandedMatch === m.existing.id;
                        const userFieldKeys = Object.keys(sel.fields);

                        return (
                          <div
                            key={m.existing.id}
                            className={`discogs-record-row discogs-record-row--match${sel.enabled ? "" : " discogs-record-row--unchecked"}`}
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
                                checked={sel.enabled}
                                onChange={(e) => {
                                  e.stopPropagation();
                                  toggleMatch(m.existing.id, e.target.checked);
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
                                      className={`discogs-badge${sel.fields[field] ? "" : " discogs-badge--off"}`}
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
                                          checked={sel.fields[field]}
                                          onChange={(e) =>
                                            toggleMatchField(
                                              m.existing.id,
                                              field,
                                              e.target.checked,
                                            )
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

                {newRecords.length === 0 &&
                  matchedRecords.length === 0 &&
                  ambiguousRecords.length === 0 && (
                    <div className="discogs-empty">
                      <p>
                        No new records found to sync in this Discogs
                        collection.
                      </p>
                    </div>
                  )}

                {/* Delete unmatched toggle */}
                <label className="discogs-delete-enable">
                  <input
                    type="checkbox"
                    checked={enableDeleteUnmatched}
                    onChange={(e) =>
                      toggleEnableDeleteUnmatched(
                        e.target.checked,
                        unmatchedExisting,
                      )
                    }
                  />
                  <span>Also delete records not found in Discogs</span>
                  {unmatchedExisting.length > 0 && (
                    <span className="discogs-delete-enable-count">
                      ({unmatchedExisting.length} record
                      {unmatchedExisting.length !== 1 ? "s" : ""})
                    </span>
                  )}
                </label>

                {/* Not on Discogs */}
                {enableDeleteUnmatched && unmatchedExisting.length > 0 && (
                  <section className="discogs-section discogs-section--danger">
                    <div className="discogs-section-header">
                      <label className="discogs-section-title">
                        <input
                          type="checkbox"
                          checked={
                            selectedForDeletion.size ===
                            unmatchedExisting.length
                          }
                          onChange={(e) =>
                            toggleAllDeletions(
                              e.target.checked,
                              unmatchedExisting,
                            )
                          }
                        />
                        Not on Discogs ({unmatchedExisting.length})
                      </label>
                      <span className="discogs-section-sub">
                        Checked records will be permanently deleted from your
                        collection
                      </span>
                    </div>
                    <div className="discogs-record-list">
                      {unmatchedExisting.map((record) => {
                        const checked = selectedForDeletion.has(record.id);
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
                              onChange={() => toggleDeletion(record.id)}
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

                {enableDeleteUnmatched && unmatchedExisting.length === 0 && (
                  <div className="discogs-empty">
                    <p>All records in your collection have a Discogs match.</p>
                  </div>
                )}

                {/* Footer */}
                <div className="discogs-import-footer">
                  <span className="discogs-summary">{summaryText()}</span>
                  <div className="discogs-import-actions">
                    <button
                      type="button"
                      className="cancel-btn"
                      onClick={onClose}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="primary-btn"
                      onClick={() => handleSync(unmatchedExisting)}
                      disabled={
                        importCount === 0 &&
                        updateCount === 0 &&
                        deleteCount === 0
                      }
                    >
                      Sync
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
