/**
 * src/index.jsx
 *
 * Browser entrypoint for the main Hexatone SPA.
 *
 * It mounts App, installs development-time prop-type checking, and registers
 * the production service worker without interrupting active sessions on update.
 */
import { render } from "preact";
import { options } from "preact";
import PropTypes from "prop-types";
import App from "./app.jsx";
import { debugLog, warnLog } from "./debug/logging.js";
import "./debug/sequencer-crash-diagnostics.js";
import "normalize.css";
import "./hex-style.css";
import "./loader.css";
import "./settings/settings.css";
import "./manual/manual-shared.css";
import "./keyboard/keyboard.css";

if (import.meta.env.DEV) {
  // installs global prop type checking for app preact components
  options.vnode = (vnode) => {
    let Component = vnode.type;
    if (Component && Component.propTypes) {
      PropTypes.checkPropTypes(Component.propTypes, vnode.props);
    }
  };
}

// ── Register service worker (production only) ──────────────────────────────
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const serviceWorkerUrl = `${import.meta.env.BASE_URL}sw.js`;
    navigator.serviceWorker
      .register(serviceWorkerUrl)
      .then((reg) => {
        debugLog("lifecycle", "Service Worker registered:", reg.scope);

        // Check for updates on page load
        reg.update();

        // Updates wait until this page is naturally closed/reloaded. Never
        // take control of a live session or reload while the user is working.
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              debugLog("lifecycle", "Service Worker update ready; it will activate on a later visit.");
            }
          });
        });
      })
      .catch((err) => {
        warnLog("Service Worker registration failed:", err);
      });
  });
}

render(<App />, document.getElementById("application"));
