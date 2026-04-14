/**
 * Normalizes an artist/title string for matching:
 * lowercased, leading article stripped, whitespace collapsed.
 */
function normalizeStr(str) {
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
 * Returns true if a Discogs-mapped record matches an existing collection record.
 * Primary match: discogsId equality.
 * Fallback: normalized artist + title equality.
 */
function isMatch(discogs, existing) {
  if (
    discogs.discogsId != null &&
    existing.discogsId != null &&
    discogs.discogsId === existing.discogsId
  ) {
    return true;
  }
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
 * Partitions Discogs-mapped records into two groups:
 * - `newRecords`: not in the existing collection
 * - `matchedRecords`: already present; includes the computed field enrichments
 *
 * @param {object[]} discogsRecords - Records processed through mapDiscogsRelease
 * @param {object[]} existingRecords - The current local collection
 * @returns {{ newRecords: object[], matchedRecords: object[] }}
 */
export function findMatches(discogsRecords, existingRecords) {
  const newRecords = [];
  const matchedRecords = [];

  for (const discogs of discogsRecords) {
    const existing = existingRecords.find((e) => isMatch(discogs, e));
    if (existing) {
      // Already linked via discogsId — nothing left to do, skip entirely.
      if (
        existing.discogsId != null &&
        existing.discogsId === discogs.discogsId
      ) {
        continue;
      }
      matchedRecords.push({
        discogs,
        existing,
        fieldsToUpdate: computeFieldsToUpdate(discogs, existing),
      });
    } else {
      newRecords.push(discogs);
    }
  }

  return { newRecords, matchedRecords };
}
