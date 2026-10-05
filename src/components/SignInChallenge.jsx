import { useEffect, useRef, useState } from "react";
import "./SignInChallenge.css";

function SignInChallenge({
  open,
  message = "Sign in",
  error = null,
  onSubmit,
  onCancel,
  submitting = false,
}) {
  const [password, setPassword] = useState("");
  const dialogRef = useRef(null);
  const inputRef = useRef(null);
  const restoreFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    restoreFocusRef.current = document.activeElement;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 0);

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll(
        "button:not([disabled]), input:not([disabled])",
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      restoreFocusRef.current?.focus?.();
      restoreFocusRef.current = null;
    };
  }, [open, onCancel]);

  if (!open) return null;

  function handleSubmit(event) {
    event.preventDefault();
    onSubmit(password);
  }

  return (
    <div className="sign-in-overlay" role="presentation">
      <div
        className="sign-in-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-in-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="sign-in-header">
          <div>
            <p className="sign-in-eyebrow">Administrator</p>
            <h2 id="sign-in-title">{message}</h2>
          </div>
          <button
            type="button"
            className="sign-in-close"
            onClick={onCancel}
            aria-label="Cancel sign in"
          >
            ×
          </button>
        </div>
        <p className="sign-in-copy">
          Use the administrator password to continue. Signing in does not turn
          on Edit Mode.
        </p>
        {error && (
          <p className="sign-in-error" role="alert">
            {error}
          </p>
        )}
        <form onSubmit={handleSubmit}>
          <label className="sign-in-label" htmlFor="administrator-password">
            Administrator password
          </label>
          <input
            ref={inputRef}
            id="administrator-password"
            className="sign-in-input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            disabled={submitting}
          />
          <div className="sign-in-actions">
            <button type="button" onClick={onCancel} disabled={submitting}>
              Cancel
            </button>
            <button
              type="submit"
              className="sign-in-submit"
              disabled={submitting || password.length === 0}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default SignInChallenge;
