import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Emergent contract: `yarn start` on :3000, build output in ./build, REACT_APP_BACKEND_URL for the API.
export default defineConfig({
  plugins: [react()],
  envPrefix: ["VITE_", "REACT_APP_"],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
    proxy: { "/api": { target: process.env.BACKEND_PROXY || "http://localhost:8001", changeOrigin: true } },
  },
  preview: { host: "0.0.0.0", port: 3000, allowedHosts: true },
  build: { outDir: "build", chunkSizeWarningLimit: 2500 },
});
