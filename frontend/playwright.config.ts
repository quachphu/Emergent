import { defineConfig } from "@playwright/test";

// Smoke test of the demo story. Reuses running servers if present, otherwise starts them
// (backend on an in-memory DB with faster simulated vendor replies).
export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 30_000 },
  use: { baseURL: process.env.E2E_BASE_URL || "http://localhost:3000", viewport: { width: 1440, height: 1000 }, trace: "retain-on-failure" },
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        {
          command: "cd ../backend && MONGO_URL=mongomock://e2e SIM_REPLY_MIN=2 SIM_REPLY_MAX=5 STEP_DELAY=0.4 .venv/bin/uvicorn server:app --port 8001",
          url: "http://localhost:8001/api/health",
          reuseExistingServer: true,
          timeout: 60_000,
        },
        { command: "yarn start", url: "http://localhost:3000", reuseExistingServer: true, timeout: 60_000 },
      ],
});
