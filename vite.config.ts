import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { scheduleDatabasePlugin } from "./server/viteDatabasePlugin.mjs";

export default defineConfig({
  plugins: [scheduleDatabasePlugin(), react()],
});
