# Browser e2e (Playwright)

```bash
npm run test:e2e:install   # once: Chromium
npm run test:e2e           # starts memory-store API + Vite on 7072/8081
```

Uses live API (not `VITE_MOCK_MODE`), Entra disabled, memory store. Safe alongside `npm run dev:all` (7071/8080).
