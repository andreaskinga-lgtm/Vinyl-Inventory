import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import "./VisitorHandoffModal.css";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

const COLLECTION_PATH = "/browse";

function qrValueForCollection() {
  return `${window.location.origin}${COLLECTION_PATH}`;
}

function QrCode({ value, label }) {
  return (
    <div className="handoff-qr" role="img" aria-label={label}>
      <QRCodeSVG
        value={value}
        size={256}
        bgColor="#ffffff"
        fgColor="#000000"
        level="M"
      />
    </div>
  );
}

function VisitorHandoffModal({
  step,
  settings,
  settingsError = null,
  onStep,
  onStartOver,
  onRetry,
  countdownSeconds = 0,
}) {
  const dialogRef = useRef(null);
  const startOverRef = useRef(null);
  const connectingYesRef = useRef(null);
  const wifiRevealRef = useRef(null);
  const collectionQrRef = useRef(null);
  const previousFocusRef = useRef(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [copyStatus, setCopyStatus] = useState(null);
  const wifi = settings?.wifi;
  const collectionUrl = qrValueForCollection();

  useEffect(() => {
    previousFocusRef.current = document.activeElement;
    document.body.classList.add("handoff-is-open");

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onStartOver();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR);
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
      document.body.classList.remove("handoff-is-open");
      const previousFocus = previousFocusRef.current;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [onStartOver]);

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      if (step === "connecting") connectingYesRef.current?.focus();
      else if (step === "wifi") wifiRevealRef.current?.focus();
      else if (step === "collection") collectionQrRef.current?.focus();
      else startOverRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [step]);

  async function copyPassword() {
    if (!passwordVisible || !wifi?.password) return;
    if (!navigator.clipboard?.writeText) {
      setCopyStatus("Copy unavailable on this device.");
      return;
    }

    try {
      await navigator.clipboard.writeText(wifi.password);
      setCopyStatus("Password copied.");
    } catch {
      setCopyStatus("Copy unavailable on this device.");
    }
  }

  const title =
    step === "connecting"
      ? "Open the collection on your phone"
      : step === "wifi"
        ? "Connect your phone to Wi-Fi"
        : step === "collection"
          ? "Scan to open the collection"
          : "Preparing your collection link";

  return (
    <div className="handoff-overlay">
      <section
        ref={dialogRef}
        className="handoff-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="visitor-handoff-title"
        aria-describedby="visitor-handoff-description"
      >
        <header className="handoff-header">
          <div>
            <p className="handoff-eyebrow">Open on my phone</p>
            <h2 id="visitor-handoff-title">{title}</h2>
          </div>
          <button
            type="button"
            className="handoff-start-over handoff-start-over--header"
            ref={startOverRef}
            onClick={onStartOver}
          >
            Close
          </button>
        </header>

        <div className="handoff-content">
          {countdownSeconds > 0 && (
            <p
              className="handoff-countdown"
              data-visitor-timer="true"
              role="status"
              aria-live="assertive"
            >
              Returning to Home Screen in {countdownSeconds} seconds.
            </p>
          )}

          {step === "loading" && (
            <div
              className="handoff-step handoff-step--loading"
              aria-live="polite"
            >
              {settingsError ? (
                <>
                  <p id="visitor-handoff-description" role="alert">
                    Unable to load visitor settings: {settingsError}
                  </p>
                  <button
                    type="button"
                    className="handoff-primary"
                    onClick={onRetry}
                  >
                    Try again
                  </button>
                </>
              ) : (
                <p id="visitor-handoff-description">
                  Preparing a link to the collection…
                </p>
              )}
            </div>
          )}

          {step === "connecting" && wifi && (
            <div className="handoff-step">
              <p id="visitor-handoff-description">
                Is your phone connected to <strong>{wifi.ssid}</strong>?
              </p>
              <div className="handoff-actions">
                <button
                  type="button"
                  className="handoff-primary"
                  ref={connectingYesRef}
                  onClick={() => onStep("collection")}
                >
                  Yes, show the collection
                </button>
                <button
                  type="button"
                  className="handoff-secondary"
                  onClick={() => onStep("wifi")}
                >
                  No, show Wi-Fi
                </button>
              </div>
            </div>
          )}

          {step === "wifi" && wifi && (
            <div className="handoff-step">
              <p id="visitor-handoff-description">
                Scan this code with your phone&apos;s camera to join the
                network.
              </p>
              <QrCode
                value={wifi.qrPayload}
                label={`Wi-Fi QR code for ${wifi.ssid}`}
              />
              <dl className="handoff-network-details">
                <div>
                  <dt>Network</dt>
                  <dd>{wifi.ssid}</dd>
                </div>
                <div>
                  <dt>Password</dt>
                  <dd>
                    {wifi.security === "open"
                      ? "No password required"
                      : passwordVisible
                        ? wifi.password
                        : "••••••••"}
                  </dd>
                </div>
              </dl>
              {wifi.security !== "open" && (
                <div className="handoff-password-actions">
                  <button
                    type="button"
                    className="handoff-secondary"
                    ref={wifiRevealRef}
                    onClick={() => setPasswordVisible((visible) => !visible)}
                  >
                    {passwordVisible ? "Hide password" : "Show password"}
                  </button>
                  <button
                    type="button"
                    className="handoff-secondary"
                    onClick={copyPassword}
                    disabled={!passwordVisible}
                  >
                    Copy password
                  </button>
                </div>
              )}
              {copyStatus && (
                <p
                  className="handoff-copy-status"
                  role="status"
                  aria-live="polite"
                >
                  {copyStatus}
                </p>
              )}
              <button
                type="button"
                className="handoff-primary"
                onClick={() => onStep("collection")}
              >
                I&apos;m connected — continue
              </button>
            </div>
          )}

          {step === "collection" && (
            <div className="handoff-step">
              <p id="visitor-handoff-description">
                Scan this code to browse the collection on your phone.
              </p>
              <div
                ref={collectionQrRef}
                className="handoff-collection-focus"
                tabIndex={-1}
              >
                <QrCode
                  value={collectionUrl}
                  label={`Collection QR code for ${collectionUrl}`}
                />
              </div>
              <code className="handoff-collection-url">{collectionUrl}</code>
            </div>
          )}
        </div>

        <footer className="handoff-footer">
          {/* <button
            type="button"
            className="handoff-start-over"
            onClick={onStartOver}
          >
            Start over
          </button> */}
        </footer>
      </section>
    </div>
  );
}

export default VisitorHandoffModal;
