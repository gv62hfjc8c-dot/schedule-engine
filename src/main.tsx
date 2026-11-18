import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./team.css";
import "./calendarScheduler.css";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root em falta.");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
