// main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import SupabaseGate from "./components/SupabaseGate";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SupabaseGate>
      <App />
    </SupabaseGate>
  </React.StrictMode>
);
