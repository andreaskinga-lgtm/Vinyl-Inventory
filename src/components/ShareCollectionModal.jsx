import { useEffect, useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import "./ShareCollectionModal.css";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function ShareCollectionModal({ onClose }) {
  const modalRef = useRef(null);
  const closeButtonRef = useRef(null);
  const previousFocusRef = useRef(null);
  const origin = window.location.origin;

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    closeButtonRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = modalRef.current?.querySelectorAll(
        FOCUSABLE_SELECTOR,
      );
      if (!focusable?.length) {
        event.preventDefault();
        return;
      }

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
      document.removeEventListener("keydown", handleKeyDown);
      const previousFocus = previousFocusRef.current;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [onClose]);

  return (
    <div
      className="share-modal-overlay"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="share-modal"
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-collection-title"
      >
        <div className="share-modal-header">
          <h2 id="share-collection-title">Share your collection</h2>
          <button
            type="button"
            className="share-modal-close"
            onClick={onClose}
            ref={closeButtonRef}
            aria-label="Close share dialog"
          >
            Close
          </button>
        </div>

        <p className="share-modal-invitation">
          Scan to browse the shelves.
        </p>
        <div
          className="share-modal-qr"
          role="img"
          aria-label={`QR code for ${origin}`}
        >
          <QRCodeSVG
            value={origin}
            size={256}
            bgColor="#ffffff"
            fgColor="#000000"
            level="M"
          />
        </div>
        <p className="share-modal-address-label">Open this address:</p>
        <code className="share-modal-address">{origin}</code>
        <p className="share-modal-reassurance">No app or sign-in needed.</p>
      </div>
    </div>
  );
}

export default ShareCollectionModal;
