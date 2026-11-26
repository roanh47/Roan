import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const host = document.getElementById("root");
if (!host) throw new Error("index.html has no #root element");

// The page is the same on every build: status-bar space comes from the shell
// (Android, Tauri) through the safe-area insets, never from a class this
// bundle adds to <html>.
createRoot(host).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
