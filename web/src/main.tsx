import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { shellClassName } from "./shell";
import "./styles.css";

const host = document.getElementById("root");
if (!host) throw new Error("index.html has no #root element");

// Before the first paint: the mobile status-bar floors belong to the shells
// only, so the class has to sit on <html> before anything renders.
const shell = window as { __TAURI_INTERNALS__?: unknown };
const shellClass = shellClassName({
  tauriInternals: shell.__TAURI_INTERNALS__ !== undefined,
  hostname: location.hostname,
});
if (shellClass.length > 0) document.documentElement.classList.add(shellClass);

createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
