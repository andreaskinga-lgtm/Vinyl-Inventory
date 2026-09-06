export * from "../../utils/collectionView.js";

export const VARIANTS = [
  { key: "A", name: "Crate Rail" },
  { key: "B", name: "Divider Shelf" },
  { key: "C", name: "Listening Room" },
];

export function requestedVariant() {
  const key = (
    new URLSearchParams(window.location.search).get("variant") ?? ""
  ).toUpperCase();
  return VARIANTS.some((variant) => variant.key === key) ? key : null;
}
