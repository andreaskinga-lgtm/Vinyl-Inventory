export function appendSubGenreSelection(value, item) {
  const current = Array.isArray(value) ? value : [];
  return current.includes(item) ? [...current] : [...current, item];
}
