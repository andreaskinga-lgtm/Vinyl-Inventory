export function canDismissDiscogsImport({ loading = false, syncing = false } = {}) {
  return !loading && !syncing;
}
