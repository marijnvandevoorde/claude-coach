import React from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";
import "./layout.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// Register the PWA service worker (handles Web Push). Safe to call repeatedly.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/app/sw.js", { scope: "/app/" }).catch(() => {
      /* push just stays unavailable if registration fails */
    });
  });
}
