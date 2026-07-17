# Production Refactor — Status

This file tracks the production-grade refactor. It replaces an earlier,
aspirational checklist that overstated the project's state.

## Done & verified (typecheck + lint + `npm run build` + `npm test`)

### Foundation
- **Settings persistence** (`electron/config/`): atomic JSON at
  `userData/settings.json`, value coercion/validation, versioned migrations,
  corrupt-file recovery, debounced writes, live change events. Settings survive
  restarts and apply without a restart.
- **Configurable shortcuts** (`electron/shortcuts/` + Settings → Shortcuts):
  typed action registry, accelerator validation, in-app vs OS conflict
  detection, live re-registration, disable/reset, import/export. Fixed the
  window-move `step = 0` no-op.
- **Provider-aware AI** (`electron/LLMHelper.ts`, `electron/llm/providers.ts`):
  Ollama plus OpenAI-compatible profiles, low/high/vision model roles,
  Auto/Low/High routing, dynamic model discovery, capability flags, health
  checks, retries, timeouts, cancellation, runtime switching, secure API-key
  storage, and graceful fallback.
- **Security/lifecycle**: `nodeIntegration:false` + `sandbox:true`,
  path-traversal guards on file IPC, navigation/popup blocking, single-instance
  lock, graceful settings flush, multi-monitor bounds clamping, screenshot
  capture mutex + guaranteed temp-file cleanup, remote provider opt-in, and
  settings export without secrets.
- **Build/tooling**: added `vite.config.ts`, the build now compiles the Electron
  main process, removed the duplicate lockfile and the deprecated
  `@types/electron`, ESLint + Prettier, `typecheck`/`lint`/`format`/`test`
  scripts, neutral app identity.

### UI / UX
- In-app **Settings panel** with General / AI / Shortcuts / Window / Privacy /
  Diagnostics sections, search, settings import/export, restore defaults, and
  live updates.
- **Global and local shortcuts** with press-to-record capture, local/global
  duplicate prevention, reserved shortcut warnings, category filters, search,
  disable/reset, and persistence.
- **Theme support** for Dark, Light, and System, applied live.
- Chat streaming now follows the bottom; react-query caching made sane; removed a
  duplicate IPC listener and dead `ModelSelector` code.

### Tests
- Vitest unit tests for settings coercion, provider privacy gates, migrations,
  deep-merge/diff, model routing, parsing, and shortcut validation/conflict
  detection (79 tests passing).

## Remaining

- **Renderer decomposition**: `Queue/Solutions/Debug` are still large; split into
  hooks/components.
- **Packaging**: generate icon binaries (`assets/README.md`) for `npm run dist`.
- **E2E**: Playwright/Electron smoke tests.

## Verify

```bash
npm run typecheck   # both renderer and main
npm test            # unit tests
npm run build       # full production build
```
