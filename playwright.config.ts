import { defineConfig, devices } from "@playwright/test";

const FRONTEND_PORT = Number(process.env.E2E_FRONTEND_PORT || 8081);
const BACKEND_PORT = Number(process.env.E2E_BACKEND_PORT || 7072);
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

/**
 * Browser e2e: live frontend + memory-store backend, auth disabled (no Entra).
 * Run: npm run test:e2e:install  (once)
 *      npm run test:e2e
 *
 * Defaults to ports 7072/8081 so a local `npm run dev:all` (7071/8080) can stay up.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  timeout: 60_000,
  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
    ...devices["Desktop Chrome"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node index.js",
      cwd: "./backend",
      url: `${BACKEND_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        PORT: String(BACKEND_PORT),
        USE_MEMORY_STORE: "1",
        DATABASE_URL: "",
        ENTRA_TENANT_ID: "your-test-tenant",
        ENTRA_CLIENT_ID: "your-test-client",
        DEFAULT_TENANT_ID: "t1",
      },
    },
    {
      command: `npx vite --host 127.0.0.1 --port ${FRONTEND_PORT}`,
      cwd: "./frontend",
      url: FRONTEND_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_MOCK_MODE: "false",
        VITE_API_BASE_URL: BACKEND_URL,
        VITE_ENTRA_CLIENT_ID: "",
        VITE_ENTRA_TENANT_ID: "",
      },
    },
  ],
});
