export function createRequestGeneration() {
  let current = 0;

  return Object.freeze({
    capture() {
      return current;
    },
    invalidate() {
      current += 1;
      return current;
    },
    isCurrent(generation) {
      return generation === current;
    },
  });
}
