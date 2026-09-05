import {
  findMatches,
  computeFieldsToUpdate,
  titleKey,
} from "./discogsMapper";

/**
 * The Sync Plan module: everything a Discogs sync review will do to the
 * collection, held as one plain value behind a small pure interface.
 *
 *   beginSync(mappedReleases, existingRecords) -> plan
 *   reducer(plan, intent) -> plan
 *   describePlan(plan) -> view model + the (toImport, updates, deletions) triple
 *
 * The plan snapshots the collection once, at `beginSync`: a sync review is a
 * review of *one moment* of the collection, and every intent is a function of
 * `(plan, intent)` alone. Nothing derived is stored — `describePlan` recomputes
 * it, so no two pieces of state can drift apart.
 */

/** User-facing field keys (not discogsId, which is applied silently). */
export const USER_FIELDS = ["coverUrl", "genre", "subGenres", "year"];

/**
 * Builds the per-field toggle map for a match. Every proposed field starts
 * enabled, which is safe because `computeFieldsToUpdate` only ever proposes a
 * field the existing record is missing — a sync fills blanks, never overwrites.
 */
function initialFieldToggles(fieldsToUpdate) {
  const fields = {};
  for (const f of USER_FIELDS) {
    if (f in fieldsToUpdate) fields[f] = true;
  }
  return fields;
}

/**
 * Partitions freshly mapped Discogs releases against a snapshot of the
 * collection and returns the initial plan.
 *
 * Keys are minted here, once, as opaque monotonic ids ("r0", "r1", …) and
 * stored on the entry. They are stable whether or not `discogsId` is present,
 * live in a single namespace, and must never be re-derived from an array index
 * at read time.
 *
 * @param {object[]} mappedReleases - Records processed through mapDiscogsRelease
 * @param {object[]} existingRecords - The current local collection
 */
export function beginSync(mappedReleases, existingRecords = []) {
  const { newRecords, matchedRecords, ambiguousRecords } = findMatches(
    mappedReleases,
    existingRecords,
  );

  let nextKey = 0;
  const mintKey = () => `r${nextKey++}`;

  const pending = [
    ...newRecords.map((discogs) => ({
      key: mintKey(),
      bucket: "new",
      discogs,
      candidateIds: [],
      // New releases default to selected; ambiguous ones never do — importing
      // an unresolved ambiguous release must be an explicit act.
      selected: true,
    })),
    ...ambiguousRecords.map((entry) => ({
      key: mintKey(),
      bucket: "ambiguous",
      discogs: entry.discogs,
      candidateIds: [...entry.candidateIds],
      selected: false,
    })),
  ];

  const matches = matchedRecords.map((m) => ({
    key: mintKey(),
    discogs: m.discogs,
    existingId: m.existing.id,
    fieldsToUpdate: m.fieldsToUpdate,
    enabled: true,
    fields: initialFieldToggles(m.fieldsToUpdate),
  }));

  return {
    existingRecords,
    // Every discogsId in the fetched collection, including releases already
    // linked locally — lets us tell "gone from Discogs" from "never linked".
    fetchedDiscogsIds: mappedReleases
      .map((r) => r.discogsId)
      .filter((id) => id != null),
    pending,
    matches,
    deletionsEnabled: false,
    deletionIds: [],
    pendingReassign: null,
  };
}

function findRecord(plan, recordId) {
  return plan.existingRecords.find((r) => r.id === recordId) ?? null;
}

/** Applies a manual match, moving a pending entry into the match list. */
function applyManualMatch(plan, releaseKey, recordId) {
  const entry = plan.pending.find((p) => p.key === releaseKey);
  const existing = findRecord(plan, recordId);
  if (!entry || !existing) return plan;

  const fieldsToUpdate = computeFieldsToUpdate(entry.discogs, existing);

  return {
    ...plan,
    pending: plan.pending.filter((p) => p.key !== releaseKey),
    matches: [
      // A record can only be matched once — a re-match replaces the old entry.
      ...plan.matches.filter((m) => m.existingId !== existing.id),
      {
        key: entry.key,
        discogs: entry.discogs,
        existingId: existing.id,
        fieldsToUpdate,
        enabled: true,
        fields: initialFieldToggles(fieldsToUpdate),
      },
    ],
    pendingReassign: null,
  };
}

/**
 * The plan reducer: `(plan, intent) -> plan`. Pure, and total — an unknown or
 * inapplicable intent returns the plan unchanged.
 */
export function reducer(plan, intent) {
  switch (intent.type) {
    case "toggleImport": {
      return {
        ...plan,
        pending: plan.pending.map((p) =>
          p.key === intent.releaseKey ? { ...p, selected: !p.selected } : p,
        ),
      };
    }

    case "toggleAllImports": {
      const { bucket, on } = intent;
      if (bucket === "matched") {
        return {
          ...plan,
          matches: plan.matches.map((m) => ({ ...m, enabled: on })),
        };
      }
      if (bucket === "deletions") {
        return {
          ...plan,
          deletionIds: on ? unmatchedExisting(plan).map((r) => r.id) : [],
        };
      }
      return {
        ...plan,
        pending: plan.pending.map((p) =>
          p.bucket === bucket ? { ...p, selected: on } : p,
        ),
      };
    }

    case "matchManually": {
      const entry = plan.pending.find((p) => p.key === intent.releaseKey);
      const existing = findRecord(plan, intent.recordId);
      if (!entry || !existing) return plan;
      // Reassigning a record already claimed by a *different* release is a
      // guarded transition, not a UI affordance — it needs confirmation.
      if (
        existing.discogsId != null &&
        existing.discogsId !== entry.discogs.discogsId
      ) {
        return {
          ...plan,
          pendingReassign: {
            releaseKey: intent.releaseKey,
            recordId: intent.recordId,
          },
        };
      }
      return applyManualMatch(plan, intent.releaseKey, intent.recordId);
    }

    case "confirmReassignment": {
      if (!plan.pendingReassign) return plan;
      const { releaseKey, recordId } = plan.pendingReassign;
      return applyManualMatch(plan, releaseKey, recordId);
    }

    case "cancelReassignment": {
      if (!plan.pendingReassign) return plan;
      return { ...plan, pendingReassign: null };
    }

    case "setMatchEnabled": {
      return {
        ...plan,
        matches: plan.matches.map((m) =>
          m.existingId === intent.recordId ? { ...m, enabled: intent.on } : m,
        ),
      };
    }

    case "setFieldEnabled": {
      return {
        ...plan,
        matches: plan.matches.map((m) =>
          m.existingId === intent.recordId
            ? { ...m, fields: { ...m.fields, [intent.field]: intent.on } }
            : m,
        ),
      };
    }

    case "setDeletionsEnabled": {
      // Deletion is irreversible, so enabling selects nothing: the user opts
      // in per record, or uses the select-all control once.
      return { ...plan, deletionsEnabled: intent.on, deletionIds: [] };
    }

    case "toggleDeletion": {
      const has = plan.deletionIds.includes(intent.recordId);
      return {
        ...plan,
        deletionIds: has
          ? plan.deletionIds.filter((id) => id !== intent.recordId)
          : [...plan.deletionIds, intent.recordId],
      };
    }

    default:
      return plan;
  }
}

/**
 * Existing records with no Discogs counterpart in this sync.
 *
 * Excludes records being enriched (matched), and the candidates of any still
 * unresolved ambiguous release: the sync is offering those for manual
 * matching, so they are not "not on Discogs". A claimed record is excluded
 * only when its linked release is confirmed present in the fetched collection.
 */
function unmatchedExisting(plan) {
  const matchedIds = new Set(plan.matches.map((m) => m.existingId));
  const candidateIds = new Set(plan.pending.flatMap((p) => p.candidateIds));
  const fetchedIds = new Set(plan.fetchedDiscogsIds);

  return plan.existingRecords.filter(
    (e) =>
      !matchedIds.has(e.id) &&
      !candidateIds.has(e.id) &&
      (e.discogsId == null || !fetchedIds.has(e.discogsId)),
  );
}

/**
 * Finds an existing claimed (discogsId != null) record sharing normalized
 * artist+title with a "new" release — used only to render an informational
 * hint explaining why a release that looks like a duplicate showed up as new.
 */
function findClaimedSibling(discogs, existingRecords) {
  const key = titleKey(discogs);
  if (key == null) return null;
  return (
    existingRecords.find(
      (e) => e.discogsId != null && titleKey(e) === key,
    ) ?? null
  );
}

function pluralize(count, noun) {
  return `${count} ${noun}${count !== 1 ? "s" : ""}`;
}

/**
 * Derives everything the review UI and `onImport` need from a plan. Pure, and
 * cheap enough to run on every render — nothing here is ever stored back into
 * the plan.
 *
 * `toImport` / `updates` / `deletions` are exactly the triple
 * `handleDiscogsImport` consumes.
 */
export function describePlan(plan) {
  const newEntries = plan.pending
    .filter((p) => p.bucket === "new")
    .map((p) => ({
      ...p,
      claimedSibling: findClaimedSibling(p.discogs, plan.existingRecords),
    }));
  const ambiguousEntries = plan.pending.filter((p) => p.bucket === "ambiguous");

  const matches = plan.matches.map((m) => ({
    ...m,
    existing: findRecord(plan, m.existingId),
  }));

  const matchedIds = new Set(plan.matches.map((m) => m.existingId));
  const pickableExisting = plan.existingRecords.filter(
    (e) => !matchedIds.has(e.id),
  );

  const unmatched = unmatchedExisting(plan);
  const selectedDeletions = new Set(plan.deletionIds);
  // Filtering against the live unmatched list is what stops the deletion set
  // drifting from the classification: a record that stops being unmatched
  // (e.g. resolved via manual match) cannot be deleted even if still checked.
  const deletions = plan.deletionsEnabled
    ? unmatched.filter((r) => selectedDeletions.has(r.id)).map((r) => r.id)
    : [];

  const toImport = plan.pending.filter((p) => p.selected).map((p) => p.discogs);

  const updates = plan.matches
    .filter((m) => m.enabled)
    .map((m) => {
      const fields = { discogsId: m.fieldsToUpdate.discogsId };
      for (const [field, on] of Object.entries(m.fields)) {
        if (on && field in m.fieldsToUpdate) {
          fields[field] = m.fieldsToUpdate[field];
        }
      }
      return { existingId: m.existingId, fields };
    });

  const counts = {
    imports: toImport.length,
    updates: updates.length,
    deletions: deletions.length,
  };

  const parts = [];
  if (counts.imports > 0)
    parts.push(`Import ${pluralize(counts.imports, "new record")}`);
  if (counts.updates > 0)
    parts.push(`update ${pluralize(counts.updates, "existing record")}`);
  if (counts.deletions > 0)
    parts.push(`delete ${pluralize(counts.deletions, "record")}`);

  return {
    toImport,
    updates,
    deletions,
    counts,
    summary: parts.length > 0 ? parts.join(", ") : "No changes selected",

    // View model
    newEntries,
    ambiguousEntries,
    matches,
    pickableExisting,
    unmatched,
    deletionsEnabled: plan.deletionsEnabled,
    selectedDeletions,
    allNewChecked:
      newEntries.length > 0 && newEntries.every((p) => p.selected),
    allAmbiguousChecked:
      ambiguousEntries.length > 0 && ambiguousEntries.every((p) => p.selected),
    allMatchesEnabled:
      matches.length > 0 && matches.every((m) => m.enabled),
    allDeletionsChecked:
      unmatched.length > 0 && unmatched.every((r) => selectedDeletions.has(r.id)),
    isEmpty: plan.pending.length === 0 && plan.matches.length === 0,
    pendingReassign: plan.pendingReassign
      ? {
          releaseKey: plan.pendingReassign.releaseKey,
          existingRecord: findRecord(plan, plan.pendingReassign.recordId),
        }
      : null,
  };
}

/** The empty plan, for a modal that has not fetched yet. */
export function emptyPlan() {
  return beginSync([], []);
}
