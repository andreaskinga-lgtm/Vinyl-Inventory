/**
 * Normalizes an artist/title string for matching:
 * lowercased, leading article stripped, whitespace collapsed.
 */
export function normalizeStr(str) {
  return String(str ?? "")
    .toLowerCase()
    .trim()
    .replace(/^(the|a|an)\s+/, "")
    .replace(/\s+/g, " ");
}

/**
 * Strips Discogs' artist disambiguation suffix, e.g. "The Beatles (2)" → "The Beatles".
 */
function stripDiscogsArtistSuffix(name) {
  return String(name ?? "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .trim();
}

/**
 * Maps a single entry from the Discogs collection API
 * (releases[n].basic_information) to the local record shape.
 *
 * @param {object} item - A raw releases[] entry from the Discogs collection API
 * @returns {object} A record shaped like the local schema (no `id`)
 */
export function mapDiscogsRelease(item) {
  const info = item.basic_information ?? item;
  const rawArtist = info.artists?.[0]?.name ?? "";
  const year = info.year && info.year !== 0 ? info.year : null;

  return {
    artist: stripDiscogsArtistSuffix(rawArtist),
    title: info.title ?? "",
    year,
    genre: info.genres?.[0] ?? "",
    subGenres: Array.isArray(info.styles) ? [...info.styles] : [],
    location: "",
    coverUrl: info.cover_image ?? info.thumb ?? "",
    vinylUrl: "",
    vinylUrl2: "",
    discogsId: info.id ?? null,
  };
}

/**
 * Returns true if a Discogs-mapped record and an existing collection record
 * are bound to the same specific release (discogsId equality). This is the
 * only match that can apply regardless of the existing record's claimed state.
 */
function isPrimaryMatch(discogs, existing) {
  return (
    discogs.discogsId != null &&
    existing.discogsId != null &&
    discogs.discogsId === existing.discogsId
  );
}

/**
 * Returns true if a Discogs-mapped record and an existing collection record
 * share a normalized artist + title. This fallback is only ever consulted
 * for existing records that are still unclaimed (discogsId == null) — a
 * claimed record must never be re-linked to a different release via this path.
 */
function isFallbackMatch(discogs, existing) {
  const dk =
    normalizeStr(discogs.artist) + "\x00" + normalizeStr(discogs.title);
  const ek =
    normalizeStr(existing.artist) + "\x00" + normalizeStr(existing.title);
  return dk === ek && dk !== "\x00";
}

/**
 * Returns the subset of enrichable fields that Discogs can provide
 * and the existing record is missing.
 *
 * Exported so the UI can recompute enrichments for manual matches.
 * @public
 *
 * `discogsId` is always included — it links the record to Discogs.
 * `coverUrl`, `genre`, `subGenres`, `year` are included only when the
 * existing record has no value and Discogs does.
 */
export function computeFieldsToUpdate(discogs, existing) {
  const fields = {
    discogsId: discogs.discogsId,
  };

  if (!existing.coverUrl && discogs.coverUrl) {
    fields.coverUrl = discogs.coverUrl;
  }
  if (!existing.genre && discogs.genre) {
    fields.genre = discogs.genre;
  }
  if (
    (!existing.subGenres || existing.subGenres.length === 0) &&
    discogs.subGenres.length > 0
  ) {
    fields.subGenres = discogs.subGenres;
  }
  if (!existing.year && discogs.year) {
    fields.year = discogs.year;
  }

  return fields;
}

/**
 * Partitions Discogs-mapped records into three groups:
 * - `newRecords`: not in the existing collection (or all same-title
 *   candidates are already claimed by a different release) — eligible to be
 *   added as a new record, e.g. a second pressing of an album already owned.
 * - `matchedRecords`: exactly one unclaimed existing record shares the
 *   discogsId or artist+title — auto-matched, with computed field
 *   enrichments.
 * - `ambiguousRecords`: more than one unclaimed existing record shares
 *   artist+title — cannot be auto-matched without guessing which physical
 *   copy it belongs to; requires manual resolution.
 *
 * A record is "claimed" once its `discogsId` is set. Claimed records are
 * never reassigned to a different incoming release via the artist+title
 * fallback, even if their own linked release is no longer present in the
 * fetched Discogs collection.
 *
 * @param {object[]} discogsRecords - Records processed through mapDiscogsRelease
 * @param {object[]} existingRecords - The current local collection
 * @returns {{ newRecords: object[], matchedRecords: object[], ambiguousRecords: object[] }}
 */
export function findMatches(discogsRecords, existingRecords) {
  const newRecords = [];
  const matchedRecords = [];
  const ambiguousRecords = [];

  for (const discogs of discogsRecords) {
    const primaryMatch = existingRecords.find((e) =>
      isPrimaryMatch(discogs, e),
    );
    if (primaryMatch) {
      // Already linked via discogsId — nothing left to do, skip entirely.
      continue;
    }

    // Fallback matching only ever considers unclaimed candidates — a claimed
    // record can't be re-linked to a different incoming release this way.
    const fallbackCandidates = existingRecords.filter(
      (e) => e.discogsId == null && isFallbackMatch(discogs, e),
    );

    if (fallbackCandidates.length === 0) {
      newRecords.push(discogs);
    } else if (fallbackCandidates.length === 1) {
      const existing = fallbackCandidates[0];
      matchedRecords.push({
        discogs,
        existing,
        fieldsToUpdate: computeFieldsToUpdate(discogs, existing),
      });
    } else {
      ambiguousRecords.push(discogs);
    }
  }

  return { newRecords, matchedRecords, ambiguousRecords };
}
