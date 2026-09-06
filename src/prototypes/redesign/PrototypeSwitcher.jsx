// PROTOTYPE — throwaway. Floating variant switcher.
import { useEffect } from "react";
import "./PrototypeSwitcher.css";

function PrototypeSwitcher({ variants, current, onChange }) {
  const index = Math.max(
    0,
    variants.findIndex((v) => v.key === current),
  );

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const el = document.activeElement;
      const tag = el?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || el?.isContentEditable) return;
      if (!e.altKey) return; // Alt+←/→ so variants don't fight the flip view
      e.preventDefault();
      const delta = e.key === "ArrowLeft" ? -1 : 1;
      onChange(
        variants[(index + delta + variants.length) % variants.length].key,
      );
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [index, variants, onChange]);

  function step(delta) {
    onChange(variants[(index + delta + variants.length) % variants.length].key);
  }

  return (
    <div className="proto-switcher" role="group" aria-label="Prototype variant">
      <button type="button" onClick={() => step(-1)} aria-label="Previous variant">
        ◀
      </button>
      <span className="proto-switcher-label">
        <em>PROTOTYPE</em>
        {variants[index].key} · {variants[index].name}
      </span>
      <button type="button" onClick={() => step(1)} aria-label="Next variant">
        ▶
      </button>
    </div>
  );
}

export default PrototypeSwitcher;
