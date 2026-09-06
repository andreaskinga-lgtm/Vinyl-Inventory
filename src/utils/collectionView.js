import { useEffect, useState } from "react";

export function filterRecords(records, query) {
  const q = query.trim().toLowerCase();
  if (!q) return records;
  return records.filter(
    (r) =>
      r.title?.toLowerCase().includes(q) ||
      r.artist?.toLowerCase().includes(q) ||
      r.genre?.toLowerCase().includes(q) ||
      (Array.isArray(r.subGenres) &&
        r.subGenres.some((sg) => sg.toLowerCase().includes(q))) ||
      r.location?.toLowerCase().includes(q),
  );
}

function normalizeArtist(value = "") {
  const stripped = value.replace(/^(?:the|a)\s+/i, "").trim();
  return stripped.length > 0 ? stripped : value;
}

function compareArtist(a, b) {
  return normalizeArtist((a.artist ?? "").trim()).localeCompare(
    normalizeArtist((b.artist ?? "").trim()),
    undefined,
    { sensitivity: "base" },
  );
}

function compareYear(a, b) {
  const yA = Number(a.year);
  const yB = Number(b.year);
  if (Number.isNaN(yA) && Number.isNaN(yB)) return 0;
  if (Number.isNaN(yA)) return 1;
  if (Number.isNaN(yB)) return -1;
  return yA - yB;
}

export const SORTS = [
  { key: "artist-asc", short: "A–Z", label: "Artist A–Z" },
  { key: "artist-desc", short: "Z–A", label: "Artist Z–A" },
  { key: "year-desc", short: "Newest", label: "Year — newest first" },
  { key: "year-asc", short: "Oldest", label: "Year — oldest first" },
  { key: "genre-asc", short: "Genre", label: "Genre A–Z" },
];

export function sortRecords(records, sort) {
  const [field, dir] = sort.split("-");
  const mul = dir === "desc" ? -1 : 1;
  return [...records].sort((a, b) => {
    let primary = 0;
    let secondary = 0;
    if (field === "artist") {
      primary = compareArtist(a, b);
      secondary = compareYear(a, b);
    } else if (field === "year") {
      primary = compareYear(a, b);
      secondary = compareArtist(a, b);
    } else if (field === "genre") {
      primary = (a.genre ?? "").localeCompare(b.genre ?? "", undefined, {
        sensitivity: "base",
      });
      secondary = compareArtist(a, b);
    }
    return primary * mul || secondary;
  });
}

export function dividerKeyFor(record, sort) {
  const field = sort.split("-")[0];
  if (field === "genre") return record.genre || "Unfiled";
  if (field === "year") {
    const y = Number(record.year);
    return Number.isNaN(y) ? "Unknown" : `${Math.floor(y / 10) * 10}s`;
  }
  const first = normalizeArtist((record.artist ?? "").trim())
    .charAt(0)
    .toUpperCase();
  return /[A-Z]/.test(first) ? first : "#";
}

export function groupByDivider(sortedRecords, sort) {
  const groups = [];
  let current = null;
  for (const record of sortedRecords) {
    const key = dividerKeyFor(record, sort);
    if (!current || current.key !== key) {
      current = { key, records: [] };
      groups.push(current);
    }
    current.records.push(record);
  }
  return groups;
}

export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function imagesFor(record) {
  return [record.coverUrl, record.vinylUrl, record.vinylUrl2].filter(Boolean);
}

export function metaLine(record) {
  return [record.year, record.genre, ...(record.subGenres ?? [])]
    .filter(Boolean)
    .join(" · ");
}

export function useTracklist(discogsId) {
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!discogsId) return undefined;
    let alive = true;
    fetch(`/api/discogs/release?id=${encodeURIComponent(discogsId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        setResult({
          id: discogsId,
          tracks: Array.isArray(data.tracklist) ? data.tracklist : null,
        });
      })
      .catch(() => {
        if (alive) setResult({ id: discogsId, tracks: null });
      });
    return () => {
      alive = false;
    };
  }, [discogsId]);

  const settled = !!result && result.id === discogsId;
  return {
    loading: !!discogsId && !settled,
    tracks: settled ? result.tracks : null,
  };
}
