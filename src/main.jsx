import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

if (
  import.meta.env.DEV &&
  import.meta.env.MODE !== "pwa-test" &&
  "serviceWorker" in navigator
) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) =>
      Promise.all(registrations.map((registration) => registration.unregister())),
    )
    .catch((error) => {
      console.error("Unable to clean up development service workers:", error);
    });
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
