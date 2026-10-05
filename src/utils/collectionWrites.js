function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) =>
    left.localeCompare(right),
  );
}

const COLLECTION_WRITE_CLEANUPS = Object.freeze({
  "add-record": "close-add-record",
  "edit-record": "close-edit-record",
  "delete-record": "close-edit-record",
  "discogs-import": "close-discogs-import",
  "genre-options": "keep-open",
});

export function getCollectionWriteSuccessCleanup(action) {
  return COLLECTION_WRITE_CLEANUPS[action?.completion] ?? null;
}

export function addRecord(records, record, id) {
  return [{ id, ...record }, ...records];
}

export function editRecord(records, id, updatedFields) {
  return records.map((record) =>
    record.id === id ? { ...record, ...updatedFields } : record,
  );
}

export function deleteRecord(records, id) {
  return records.filter((record) => record.id !== id);
}

export function applyDiscogsImport(
  records,
  newRecords,
  updates,
  deletions = [],
  generateId,
) {
  const deletionSet = new Set(deletions);
  const enriched = records
    .filter((record) => !deletionSet.has(record.id))
    .map((record) => {
      const update = updates.find(
        (candidate) => candidate.existingId === record.id,
      );
      return update ? { ...record, ...update.fields } : record;
    });
  const created = newRecords.map((record) => ({
    id: generateId(),
    ...record,
  }));
  return [...created, ...enriched];
}

export function addGenre(genres, genre) {
  return genres.includes(genre) ? [...genres] : sortedUnique([...genres, genre]);
}

export function addSubGenre(subGenres, subGenre) {
  return subGenres.includes(subGenre)
    ? [...subGenres]
    : sortedUnique([...subGenres, subGenre]);
}

export function deleteSubGenre(subGenres, subGenre) {
  return subGenres.filter((value) => value !== subGenre);
}
