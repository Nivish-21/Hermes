import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

const envDir = fileURLToPath(new URL("../", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, "VITE_");
  const convexUrl = env.VITE_CONVEX_URL;
  if (convexUrl === undefined || convexUrl.trim() === "") {
    throw new Error("VITE_CONVEX_URL must be configured before building the dashboard");
  }
  return {
    root: "dashboard",
    envDir,
    plugins: [react()],
    build: { outDir: "dist", emptyOutDir: true },
  };
});
