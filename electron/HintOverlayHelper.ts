import { BrowserWindow, screen, Rectangle } from "electron"
import { SettingsService } from "./config/SettingsService"

const isDev = process.env.NODE_ENV === "development"

/** Option letters, encoded by a dot COUNT (A=1 … E=5). */
export type HintLetter = "A" | "B" | "C" | "D" | "E"
const VALID_LETTERS: readonly HintLetter[] = ["A", "B", "C", "D", "E"]

// Visual/behavioural tuning for the blink. Kept here so the overlay HTML stays
// purely presentational and driven entirely by the main process.
const DOT_SIZE_PX = 3 // deliberately tiny and unobtrusive (fill diameter)
const DOT_BORDER_PX = 2 // white ring so the black core reads on dark backgrounds too
const DOT_BORDER_COLOR = "#ffffff"
const DOT_COLOR = "#000000" // solid black core, no glow — stealthy
const DOT_GAP_PX = 7 // horizontal gap between adjacent dots in a row
const EDGE_MARGIN_PX = 30 // inset of the row from the top-left corner
const PULSE_PERIOD_MS = 650
// A single-answer row lingers; a multi-answer sequence shows each letter's count
// in turn (SEQ_ON on, SEQ_GAP blank) so the counts are never conflated.
const SINGLE_ON_MS = 4200
const SEQ_ON_MS = 1600
const SEQ_GAP_MS = 450

/**
 * A dedicated, stealthy overlay window that conveys a multiple-choice answer as
 * a COUNT of dots in a horizontal row at the TOP-LEFT corner — no readable text:
 *
 *   A → 1 dot   B → 2 dots   C → 3 dots   D → 4 dots   E → 5 dots
 *
 * A single answer shows its row of dots for a few seconds. Multiple correct
 * options are shown as sequential groups: each letter's dot-count in turn with a
 * blank gap between them, so e.g. "B, D" reads as 2 dots … (gap) … 4 dots.
 *
 * The window mirrors the main overlay's stealth hardening — transparent,
 * frameless, click-through, non-focusable, skip-taskbar, hidden in Mission
 * Control, and (by default) content-protected so it is excluded from screen
 * capture/share. It is created lazily on first use and reused, repositioning
 * onto whichever display the app's main window currently occupies.
 */
export class HintOverlayHelper {
  private window: BrowserWindow | null = null
  private ready = false
  private pending: HintLetter[] | null = null
  private hideTimer: NodeJS.Timeout | null = null
  private readonly getAnchorBounds: () => Rectangle | null
  private settings = SettingsService.getInstance()

  /**
   * @param getAnchorBounds Returns the bounds used to pick the target display
   *   (typically the main overlay's bounds). Falls back to the primary display.
   */
  constructor(getAnchorBounds: () => Rectangle | null) {
    this.getAnchorBounds = getAnchorBounds
  }

  /** Blink dots for the given options. Invalid/empty selections are ignored. */
  public blink(letters: HintLetter[]): void {
    const valid = Array.from(new Set(letters)).filter((l): l is HintLetter =>
      (VALID_LETTERS as readonly string[]).includes(l)
    )
    if (valid.length === 0) return

    this.ensureWindow()
    this.positionOverActiveDisplay()

    const win = this.window
    if (!win || win.isDestroyed()) return

    // Re-assert content protection on every reveal (the OS can drop it across
    // show/hide), matching the main window's defense-in-depth.
    win.setContentProtection(this.settings.get("window").contentProtection)
    if (!win.isVisible()) win.showInactive()

    if (this.ready) {
      this.sendDots(valid)
    } else {
      // webContents not loaded yet — flush once did-finish-load fires.
      this.pending = valid
    }

    this.scheduleHide(this.totalDurationMs(valid.length))
  }

  /** Total time the sequence runs, so the auto-hide fires after it completes. */
  private totalDurationMs(count: number): number {
    return count <= 1 ? SINGLE_ON_MS : count * (SEQ_ON_MS + SEQ_GAP_MS)
  }

  /** Hide the dots immediately (does not destroy the reusable window). */
  public hide(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    const win = this.window
    if (win && !win.isDestroyed() && win.isVisible()) win.hide()
  }

  public destroy(): void {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
    this.ready = false
    this.pending = null
  }

  private scheduleHide(durationMs: number): void {
    if (this.hideTimer) clearTimeout(this.hideTimer)
    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      this.hide()
    }, durationMs + 250)
  }

  private sendDots(letters: HintLetter[]): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    const payload = {
      letters,
      onMs: letters.length <= 1 ? SINGLE_ON_MS : SEQ_ON_MS,
      gapMs: SEQ_GAP_MS,
      dotSize: DOT_SIZE_PX,
      dotGap: DOT_GAP_PX,
      margin: EDGE_MARGIN_PX,
      color: DOT_COLOR,
      borderPx: DOT_BORDER_PX,
      borderColor: DOT_BORDER_COLOR,
      period: PULSE_PERIOD_MS,
    }
    win.webContents
      .executeJavaScript(`window.__showDots && window.__showDots(${JSON.stringify(payload)})`)
      .catch((err) => {
        if (isDev) console.error("[HintOverlay] showDots failed:", err)
      })
  }

  private targetDisplay(): Electron.Display {
    const anchor = this.getAnchorBounds()
    if (anchor) return screen.getDisplayMatching(anchor)
    return screen.getPrimaryDisplay()
  }

  private positionOverActiveDisplay(): void {
    const win = this.window
    if (!win || win.isDestroyed()) return
    // Cover the work area (screen minus menu bar / taskbar / dock). A normal
    // window is clamped to this region by the OS anyway, so sizing to it
    // explicitly keeps dot placement deterministic across platforms and lands
    // every dot inside the always-visible area rather than under system chrome.
    win.setBounds(this.targetDisplay().workArea)
  }

  private ensureWindow(): void {
    if (this.window && !this.window.isDestroyed()) return

    const display = this.targetDisplay()
    const win = new BrowserWindow({
      ...display.workArea,
      title: "",
      type: "toolbar",
      frame: false,
      transparent: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      alwaysOnTop: true,
      focusable: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      // Purely presentational; no privileged APIs and no preload are needed.
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        devTools: isDev, // stealth: no DevTools window in production
      },
    })

    // Never intercept input — the overlay must be visually-only.
    win.setIgnoreMouseEvents(true, { forward: false })
    win.setContentProtection(this.settings.get("window").contentProtection)

    // Float above other windows, including full-screen apps and other spaces —
    // the hint must be visible over whatever the user is looking at.
    win.setAlwaysOnTop(true, "screen-saver")
    if (process.platform === "darwin") {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      win.setHiddenInMissionControl(true)
    }

    win.webContents.on("did-finish-load", () => {
      this.ready = true
      if (this.pending) {
        const letters = this.pending
        this.pending = null
        this.sendDots(letters)
      }
    })

    win.on("closed", () => {
      this.window = null
      this.ready = false
      this.pending = null
    })

    win.loadURL(
      "data:text/html;charset=utf-8," + encodeURIComponent(OVERLAY_HTML)
    ).catch((err) => {
      if (isDev) console.error("[HintOverlay] load failed:", err)
    })

    this.window = win
  }
}

// Self-contained presentational document. Exposes window.__showDots(payload),
// which renders the answer as a COUNT of pulsing dots (A=1 … E=5) in a horizontal
// row at the top-left corner. A single letter shows one row; multiple letters are
// played as sequential groups (each letter's count in turn, with a blank gap).
// No network, no external assets; a fresh call fully replaces any prior sequence.
// Exported so it can be loaded and exercised in isolation by tests/harnesses.
export const OVERLAY_HTML = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  html, body {
    margin: 0; padding: 0; width: 100%; height: 100%;
    background: transparent; overflow: hidden;
    -webkit-user-select: none; user-select: none; cursor: default;
  }
  #layer { position: fixed; inset: 0; pointer-events: none; }
  .dot {
    position: fixed;
    box-sizing: content-box;
    border-radius: 50%;
    transform-origin: center center;
    will-change: opacity, transform;
    animation: mcqPulse var(--period, 650ms) ease-in-out infinite;
  }
  @keyframes mcqPulse {
    0%, 100% { opacity: 0.18; transform: scale(0.82); }
    50%      { opacity: 1;    transform: scale(1); }
  }
  @media (prefers-reduced-motion: reduce) {
    .dot { animation: none; opacity: 0.95; }
  }
</style>
</head>
<body>
<div id="layer"></div>
<script>
  (function () {
    var LETTERS = ["A", "B", "C", "D", "E"];
    var layer = document.getElementById("layer");
    var timers = [];

    function clearTimers() {
      for (var i = 0; i < timers.length; i++) clearTimeout(timers[i]);
      timers = [];
    }

    // A dot's letter maps to a COUNT: A=1 … E=5. Render that many dots in a
    // horizontal row anchored at the top-left, spaced by (footprint + gap).
    function renderRow(count, cfg) {
      layer.innerHTML = "";
      for (var i = 0; i < count; i++) {
        var d = document.createElement("div");
        d.className = "dot";
        d.style.width = cfg.size + "px";
        d.style.height = cfg.size + "px";
        d.style.background = cfg.color;
        if (cfg.borderPx > 0) d.style.border = cfg.borderPx + "px solid " + cfg.borderColor;
        d.style.setProperty("--period", cfg.period + "ms");
        d.style.top = cfg.margin + "px";
        d.style.left = cfg.margin + i * (cfg.footprint + cfg.dotGap) + "px";
        layer.appendChild(d);
      }
    }

    window.__showDots = function (opts) {
      opts = opts || {};
      var raw = Array.isArray(opts.letters) ? opts.letters : [];
      var size = opts.dotSize || 3;
      var borderPx = opts.borderPx || 0;
      var cfg = {
        size: size,
        borderPx: borderPx,
        borderColor: opts.borderColor || "#ffffff",
        color: opts.color || "#000000",
        period: opts.period || 650,
        margin: opts.margin || 30,
        dotGap: opts.dotGap || 7,
        // Content-box: the border is drawn OUTSIDE the fill, so a dot spans
        // (size + 2*borderPx).
        footprint: size + 2 * borderPx
      };
      var onMs = opts.onMs || 4000;
      var gapMs = opts.gapMs || 450;

      // Map letters → counts (1..5), dropping anything outside A–E.
      var counts = [];
      for (var i = 0; i < raw.length; i++) {
        var idx = LETTERS.indexOf(String(raw[i]).toUpperCase());
        if (idx !== -1) counts.push(idx + 1);
      }

      clearTimers();
      layer.innerHTML = "";
      if (counts.length === 0) return;

      if (counts.length === 1) {
        renderRow(counts[0], cfg);
        timers.push(setTimeout(function () { layer.innerHTML = ""; }, onMs));
        return;
      }

      // Sequential groups: show count[k] for onMs, blank for gapMs, then count[k+1].
      var t = 0;
      for (var k = 0; k < counts.length; k++) {
        (function (n, at) {
          timers.push(setTimeout(function () { renderRow(n, cfg); }, at));
          timers.push(setTimeout(function () { layer.innerHTML = ""; }, at + onMs));
        })(counts[k], t);
        t += onMs + gapMs;
      }
    };
  })();
</script>
</body>
</html>`
