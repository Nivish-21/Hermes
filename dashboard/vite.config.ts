import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "dashboard",
  envDir: "..",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
});
