import React from "react";
import { createRoot } from "react-dom/client";
import SalesViewerApp from "@/components/SalesViewerApp";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SalesViewerApp />
  </React.StrictMode>,
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    const inIframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();

    const isPreview =
      window.location.hostname.includes("lovable") ||
      window.location.hostname.includes("id-preview--");

    if (inIframe || isPreview) {
      navigator.serviceWorker
        .getRegistrations?.()
        .then((registrations) => registrations.forEach((registration) => registration.unregister()))
        .catch(() => {});
      return;
    }

    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
