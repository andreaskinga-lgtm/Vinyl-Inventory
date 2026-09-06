// PROTOTYPE — throwaway. Redesign variants for the browse experience.
//
// "Three radically different redesigns of the whole browsing surface,
//  switchable via ?variant=, mounted on the existing single page."
//
// Run:  npm run dev  →  http://localhost:5173/?variant=A
//   A — Crate Rail       one sticky rail, unframed art, bottom-sheet detail
//   B — Divider Shelf    sticky kraft divider tabs + jump strip, full-page detail
//   C — Listening Room   no top chrome, floating dock, inline expanding detail
//
// Read-only: edit/share/sync buttons are visual placeholders.
import { useEffect, useState } from "react";
import PrototypeSwitcher from "./PrototypeSwitcher";
import VariantA from "./VariantA";
import VariantB from "./VariantB";
import VariantC from "./VariantC";
import { VARIANTS, requestedVariant } from "./shared";
import "./prototype.css";

const RENDERERS = { A: VariantA, B: VariantB, C: VariantC };

function RedesignPrototype({ records }) {
  const [variant, setVariant] = useState(() => requestedVariant() ?? "A");

  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", variant);
    window.history.replaceState({}, "", url);
    document.body.classList.add("prototype-active");
    return () => document.body.classList.remove("prototype-active");
  }, [variant]);

  const Variant = RENDERERS[variant];

  return (
    <>
      <Variant records={records} />
      <PrototypeSwitcher
        variants={VARIANTS}
        current={variant}
        onChange={setVariant}
      />
    </>
  );
}

export default RedesignPrototype;
