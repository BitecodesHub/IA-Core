# IA-Core

A private, **local-first** desktop overlay (Electron + React + Vite). It is a
frameless, always-on-top, translucent window that can capture a screenshot,
analyze it with a local or explicitly configured OpenAI-compatible model, and
stream the answer back.

> This is a hardened, refactored fork of free-cluely / interview-coder. It runs
> locally by default; remote OpenAI-compatible endpoints are blocked unless the
> user explicitly enables remote HTTPS for that provider.

## Requirements

- Node.js 20+
- [Ollama](https://ollama.ai) running locally with at least one model, e.g.:
  ```bash
  ollama serve
  ollama pull llama3.2          # text
  ollama pull llava             # vision (for screenshot analysis)
  ```

## Quick start

```bash
npm install
npm start          # dev: Vite on :5180 + Electron
```

Production build / package:

```bash
npm run build      # typecheck + renderer bundle + Electron compile
npm run dist       # package installers (requires assets/icons — see assets/README.md)
```

## Configuration

Everything is configured **in-app** (open the overlay → **General / AI /
Shortcuts / Window / Privacy / Diagnostics**) and persists across restarts in
`<userData>/settings.json`. There is no `.env` to manage.

- **AI** — provider profiles for Ollama and OpenAI-compatible endpoints,
  low/high/vision model slots, Auto/Low/High reasoning mode, model discovery,
  capability flags, health checks, secure API-key storage, fallback providers,
  retries, timeouts, and live runtime switching.
- **Shortcuts** — rebind global and in-window shortcuts by pressing keys; in-app,
  local/global duplicate, and OS conflicts are detected; disable, reset, search,
  category filtering, and import/export are supported.
  Changes apply immediately (no restart).
- **Window** — opacity, always-on-top, content protection, taskbar/tray
  visibility, and macOS Mission Control hiding.
- **General / Privacy / Diagnostics** — theme (Dark/Light/System), launch and
  warm-model behavior, local-first remote endpoint guardrails, telemetry opt-in,
  settings import/export/default restore, and provider health status.

### Default shortcuts

| Action | Default |
| --- | --- |
| Toggle window | `Cmd/Ctrl + Alt + Shift + B` |
| Center & show | `Cmd/Ctrl + Alt + Shift + S` |
| Take screenshot | `Cmd/Ctrl + Alt + Shift + H` |
| Process | `Cmd/Ctrl + Alt + Shift + Enter` |
| Reset | `Cmd/Ctrl + Alt + Shift + R` |
| Move window | `Cmd/Ctrl + Alt + Shift + Arrow keys` |
| Toggle chat | `Cmd/Ctrl + Alt + C` |
| Toggle settings | `Cmd/Ctrl + ,` |
| Focus chat | `Cmd/Ctrl + Alt + L` |
| Stop generation | `Cmd/Ctrl + Alt + .` |

## Privacy & stealth

- Inference runs locally by default. Screenshots are sent only to the active
  provider selected in Settings; external HTTPS endpoints require an explicit
  per-provider opt-in.
- Provider API keys are stored outside normal settings through Electron
  `safeStorage` and are omitted from settings export.
- **Content protection** excludes the window from screen shares and recordings.
- No dock icon (accessory app), optional tray, hidden from the taskbar and (on
  macOS) Mission Control, and the window never steals focus.

**Honest limits:** the OS process is still visible in Activity Monitor / Task
Manager, and some OS-level region screenshots cannot be excluded. This app does
not attempt to defeat proctoring or anti-cheat systems.

## Security

`nodeIntegration` is disabled, `contextIsolation` and `sandbox` are enabled, the
renderer talks to the main process only through an allow-listed preload bridge,
file paths from the renderer are validated against the screenshot directories,
and remote navigation/popups are blocked.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Dev (Vite + Electron) |
| `npm run electron:dev` | Same as `npm start`: compiles main, starts Vite on 127.0.0.1:5180, waits, launches Electron |
| `npm run build` | Typecheck + build renderer + compile main |
| `npm run typecheck` | Type-check both the renderer and main process |
| `npm test` | Unit tests (Vitest) |
| `npm run lint` / `npm run format` | ESLint / Prettier |
| `npm run dist` | Package platform installers |

## License

ISC.
