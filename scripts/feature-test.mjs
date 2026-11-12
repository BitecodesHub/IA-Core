// Full-feature end-to-end test of an INSTALLED Notes build, signed in.
//
//   node scripts/feature-test.mjs <path-to-Notes-executable> <expected-version>
//
// Runs a stand-in Bitecodes server on 127.0.0.1 and points the installed app at
// it, then uses every feature the way a person does: browser sign-in flow,
// streamed chat, screenshot capture + screenshot analysis, voice recording
// transcription, global shortcuts, window movement / hide / show, content
// protection, settings round-trip, update check, sign-out. It asserts both what
// the app shows and what it actually sent to the server. Exit 0 only if every
// check passed.
import { spawn } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))
const { startMockBitecodes } = await import(pathToFileURL(join(here, "mock-bitecodes.mjs")).href)

const [exe, expected, sourceRoot] = process.argv.slice(2)
if (!exe || !expected) {
  console.error("usage: feature-test.mjs <exe> <version>")
  process.exit(2)
}
const MAIN = 39239
const MOCK_PORT = 47123
const profile = mkdtempSync(join(tmpdir(), "notes-features-"))
const results = []
const check = (name, ok, detail = "") => {
  results.push({ name, ok })
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const until = async (fn, ms = 20_000, step = 500) => {
  const end = Date.now() + ms
  let lastError
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch (error) { lastError = error }
    if (Date.now() > end) {
      if (lastError) throw lastError
      return null
    }
    await sleep(step)
  }
}

const mock = await startMockBitecodes(MOCK_PORT, { version: expected })
const extra = process.platform === "darwin" ? ["--use-mock-keychain"] : []
let entry = []
if (sourceRoot) {
  const bootstrap = join(profile, "test-app")
  mkdirSync(bootstrap)
  writeFileSync(join(bootstrap, "package.json"), JSON.stringify({ name: "notes-test", version: expected, main: "bootstrap.cjs" }))
  writeFileSync(join(profile, "settings.json"), JSON.stringify({ ai: { providers: { bitecodes: { endpoint: mock.origin } } } }))
  writeFileSync(join(bootstrap, "bootstrap.cjs"), `
    globalThis.__testRequire = require;
    const {app, systemPreferences, shell} = require('electron');
    const root = ${JSON.stringify(sourceRoot)};
    app.setPath('userData', ${JSON.stringify(profile)});
    app.getAppPath = () => root;
    const realFetch = globalThis.fetch;
    globalThis.fetch = (input, options) => {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
      if (new URL(url).origin !== ${JSON.stringify(mock.origin)}) return Promise.reject(new Error('Non-mock network blocked by test'));
      return realFetch(input, options);
    };
    systemPreferences.askForMediaAccess = async () => true;
    systemPreferences.getMediaAccessStatus = () => 'granted';
    shell.openExternal = async (url) => { if (!url.startsWith(${JSON.stringify(mock.origin)})) throw new Error('External navigation blocked by test'); };
    const {ScreenshotHelper} = require(root + '/dist-electron/ScreenshotHelper.js');
    ScreenshotHelper.prototype.probe = async () => ({ok:true, backend:'synthetic'});
    ScreenshotHelper.prototype.capturePng = async () => require(root + '/node_modules/sharp')({create:{width:320,height:200,channels:3,background:{r:30,g:80,b:120}}}).png().toBuffer();
    require(root + '/dist-electron/main.js');
  `)
  entry = [bootstrap]
  extra.push("--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream")
}
let child = spawn(exe, [...entry, `--user-data-dir=${profile}`, `--inspect=127.0.0.1:${MAIN}`, ...extra], {
  stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "production" },
})
let output = ""
child.stdout.on("data", (d) => (output += d))
child.stderr.on("data", (d) => (output += d))
let exited = null
child.on("exit", (code, signal) => (exited = { code, signal }))

async function evaluate(expr) {
  const t = (await (await fetch(`http://127.0.0.1:${MAIN}/json/list`)).json())[0]
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("CDP timeout")), 120_000)
    ws.onmessage = (m) => {
      const d = JSON.parse(m.data)
      if (d.id !== 1) return
      clearTimeout(timer)
      ws.close()
      if (d.result?.exceptionDetails) reject(new Error(d.result.exceptionDetails.exception?.description ?? "exception"))
      else resolve(d.result?.result?.value)
    }
    ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: expr, awaitPromise: true, returnByValue: true } }))
  })
}
const main = (expr) => evaluate(sourceRoot ? expr.replaceAll("process.mainModule.require", "globalThis.__testRequire") : expr)
const win = (expr) => main(`(() => { const w = process.mainModule.require("electron").BrowserWindow.getAllWindows()[0]; return (${expr}) })()`)
const page = (js) =>
  main(`process.mainModule.require("electron").BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(${JSON.stringify(js)})`)
const sent = (path) => mock.log.filter((r) => r.path === path)
const click = async (name) => {
  const point = await until(() => page(`(async () => {
    const el = [...document.querySelectorAll('button,input,select,[role="tab"]')].find(el => el.getAttribute('aria-label') === ${JSON.stringify(name)} || el.textContent.trim() === ${JSON.stringify(name)} || [...(el.labels || [])].some(label => { const copy = label.cloneNode(true); copy.querySelectorAll('input,select,textarea').forEach(control => control.remove()); return copy.textContent.trim() === ${JSON.stringify(name)}; }));
    if (!el || el.disabled) return null;
    el.scrollIntoView({block:'nearest'});
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const r = el.getBoundingClientRect();
    el.focus();
    return r.width && r.height ? {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),button:el.tagName === 'BUTTON'} : null;
  })()`), 5000, 100)
  if (!point) throw new Error(`Control not available: ${name}`)
  if (point.button) {
    await key("Space")
  } else {
    await win(`(() => {
      w.webContents.sendInputEvent({type:'mouseMove',x:${point.x},y:${point.y}});
      w.webContents.sendInputEvent({type:'mouseDown',button:'left',clickCount:1,x:${point.x},y:${point.y}});
      w.webContents.sendInputEvent({type:'mouseUp',button:'left',clickCount:1,x:${point.x},y:${point.y}});
    })()`)
  }
  await page(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`)
}
const type = async (text) => win(`w.webContents.insertText(${JSON.stringify(text)})`)
const key = async (keyCode, modifiers = []) => {
  await win(`w.webContents.sendInputEvent(${JSON.stringify({ type: "keyDown", keyCode, modifiers })})`)
  await win(`w.webContents.sendInputEvent(${JSON.stringify({ type: "keyUp", keyCode, modifiers })})`)
}

// A 1-second 16 kHz mono WAV (a tone) — content does not matter to the mock.
function wavBase64() {
  const rate = 16000, n = rate, buf = Buffer.alloc(44 + n * 2)
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8)
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34)
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2)
  return buf.toString("base64")
}

try {
  const up = await until(async () => (await fetch(`http://127.0.0.1:${MAIN}/json/list`)).ok, 90_000, 1000)
  check("app starts", !!up && !exited)
  if (!up) throw new Error("app did not start")
  await until(async () => (await page("document.body.innerText")).includes("Sign in to Notes"), 60_000, 1000)
  check("version", (await main(`process.mainModule.require("electron").app.getVersion()`)) === expected, expected)

  // --- Settings round-trip + point the app at the stand-in server ----------
  await page(`window.electronAPI.setSettings({ ai: { providers: { bitecodes: { endpoint: "${mock.origin}" } } } })`)
  const ep = await page(`window.electronAPI.getSettings().then((s) => s.ai.providers.bitecodes.endpoint)`)
  check("settings save and read back", ep === mock.origin, ep)

  // --- Sign in through the real flow ----------------------------------------
  await click("Sign in with Bitecodes")
  const login = await until(() => page("window.electronAPI.bitecodesStatus().then(s => s.phase === 'waiting' ? s : null)"), 5000, 50)
  check("sign-in starts (code shown)", login?.phase === "waiting" && !!login.userCode, login?.userCode)
  const signedIn = await until(async () => (await page("window.electronAPI.bitecodesStatus().then((s) => s.phase)")) === "signed-in", 30_000, 1000)
  check("signs in after approval", !!signedIn)
  const gateGone = await until(async () => !(await page("document.body.innerText")).includes("Sign in to Notes"), 15_000)
  check("app unlocks after sign-in", !!gateGone)

  const hoverColors = async () => {
    const out = {}
    for (const name of ["Record voice", "Chat", "Settings"]) {
      out[name] = await until(async () => {
        const point = await page(`(() => { const el = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(name)} || b.textContent.trim() === ${JSON.stringify(name)}); const r = el.getBoundingClientRect(); return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)}; })()`)
        await win(`w.webContents.sendInputEvent({type:'mouseMove',x:${point.x},y:${point.y}})`)
        const style = await page(`new Promise(resolve => requestAnimationFrame(() => setTimeout(() => { const el = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === ${JSON.stringify(name)} || b.textContent.trim() === ${JSON.stringify(name)}); const s = getComputedStyle(el); resolve({hovered: el.matches(':hover'), color: s.color, background: s.backgroundColor}); }, 300)))`)
        return style.hovered ? style : null
      }, 5000, 100)
    }
    await win(`w.webContents.sendInputEvent({type:'mouseMove',x:1,y:1})`)
    return out
  }
  const readable = (all) => Object.values(all).every((s) => s.hovered && s.color === "rgb(255, 255, 255)" && !/^rgba?\(255, 255, 255(, 1)?\)$/.test(s.background))
  const darkHover = await hoverColors()
  check("hovered capsule buttons keep readable text", readable(darkHover), JSON.stringify(darkHover))
  if (sourceRoot) {
    const shot = join(tmpdir(), "notes-capsule.png")
    const png = await win(`w.webContents.capturePage().then(img => img.toPNG().toString('base64'))`)
    writeFileSync(shot, Buffer.from(png, "base64"))
    const logo = await page(`(() => { const img = document.querySelector('img[alt="Bitecodes"]'); return img && img.complete && img.naturalWidth > 0 ? img.naturalWidth : 0 })()`)
    check("Bitecodes logo renders in the capsule", logo > 0, shot)
  }

  // --- Chat ------------------------------------------------------------------
  await click("Chat")
  await click("Message")
  await type("Say hi")
  await click("Send")
  const chat = await until(() => page(`document.body.innerText.includes('MOCK-ANSWER: chat works') && document.body.innerText`))
  check("chat streams an answer", /MOCK-ANSWER: chat works/.test(chat ?? ""), String(chat).slice(0, 80))
  const chatReq = sent("/api/v1/desktop/assistant").at(-1)
  check("chat request: kind + app build sent", chatReq?.kind === "chat" && new RegExp(`Notes/${expected.replace(/\./g, "\\.")}`).test(chatReq?.client ?? ""), JSON.stringify({ kind: chatReq?.kind, client: chatReq?.client }))

  // --- Screenshot capture + analysis -----------------------------------------
  const shots = await page(`window.electronAPI.takeScreenshot().then(() => new Promise((r) => setTimeout(r, 2500))).then(() => window.electronAPI.getScreenshots()).then((s) => s.length)`)
  check("screenshot captured", typeof shots === "number" && shots >= 1, String(shots))
  const analysis = await page(`new Promise((res) => {
    let last = ""; const off = window.electronAPI.onScreenshotAnalysisStream((d) => { last = JSON.stringify(d); if (last.includes("def solve")) { off(); res(last) } })
    window.electronAPI.processScreenshotWithChoice("answer", "feature-screenshot").catch((e) => res("ERROR " + e))
    setTimeout(() => res(last || "TIMEOUT"), 90000)
  })`)
  check("screenshot analysis streams the answer", /MOCK-ANSWER: I can see 1 screenshot/.test(analysis ?? ""), String(analysis).slice(0, 100))
  const shotReq = sent("/api/v1/desktop/assistant").find((r) => r.images > 0)
  check("screenshot sent as an image", !!shotReq && shotReq.kind === "screenshot", JSON.stringify({ kind: shotReq?.kind, images: shotReq?.images }))

  if (sourceRoot) {
    const ready = () => page(`!document.querySelector('[aria-label="Message"]').disabled`)
    await until(ready, 5000, 100)
    mock.behavior.streamDelayMs = 500
    await click("Message")
    await type("cancel this synthetic request")
    await click("Send")
    await until(() => page(`document.querySelector('[aria-label="Conversation"]').innerText.includes('MOCK-ANSWER:')`), 5000, 100)
    await click("Stop")
    const stopped = await page(`document.querySelector('[aria-label="Conversation"]').innerText`)
    await sleep(700)
    check("Stop preserves partial chat without late updates", await ready() && stopped === await page(`document.querySelector('[aria-label="Conversation"]').innerText`))
    mock.behavior.streamDelayMs = 15
    mock.behavior.assistantFailure = true
    await click("Message")
    await type("synthetic error request")
    await click("Send")
    const failed = await until(() => page(`document.querySelector('[aria-label="Conversation"]').innerText.includes('temporarily unavailable')`), 10000, 100)
    check("chat failure appears inline and releases input", !!failed && await ready())
    mock.behavior.assistantFailure = false
    await click("Message")
    await type("synthetic retry request")
    await click("Send")
    check("chat recovers after a failed request", !!await until(ready, 10000, 100))

    mock.behavior.streamDelayMs = 500
    await main(`(() => { const r=globalThis.__testRequire; const state=r(r('path').join(r('electron').app.getAppPath(),'dist-electron/main.js')).AppState.getInstance(); return state.processingHelper.processScreenshots(); })()`)
    check("Process command opens screenshot analysis in chat", !!await until(() => page(`document.body.innerText.includes('Analyzing screenshot…') && !!document.querySelector('[aria-label="Stop"]')`), 5000, 100))
    await main(`(() => { const r=globalThis.__testRequire; const state=r(r('path').join(r('electron').app.getAppPath(),'dist-electron/main.js')).AppState.getInstance(); state.clearQueues(); state.getMainWindow().webContents.send('reset-view'); })()`)
    await sleep(700)
    check("reset clears screenshot queue and suppresses late output", await page(`document.querySelector('[aria-label="Conversation"]').innerText.includes('Take a screenshot')`) && (await page(`window.electronAPI.getScreenshots()`)).length === 0)
    mock.behavior.streamDelayMs = 15
  }

  // --- Voice ------------------------------------------------------------------
  const voice = await page(`window.electronAPI.analyzeAudioFromBase64("${wavBase64()}", "audio/wav").then((r) => r.text).catch((e) => "ERROR " + e)`)
  check("voice recording transcribed", /hello from the mock transcriber/.test(voice ?? ""), String(voice).slice(0, 90))
  const voiceReq = sent("/api/v1/desktop/transcribe").at(-1)
  check("voice sent to Bitecodes", voiceReq?.mimeType === "audio/wav" && voiceReq.audioBytes > 30000, JSON.stringify(voiceReq ?? {}))

  if (sourceRoot) {
    await click("Record voice")
    const recording = await until(() => page(`!!document.querySelector('[aria-label="Stop recording and transcribe"]')`), 5000, 100)
    check("Record starts the synthetic microphone", !!recording)
    await sleep(1200)
    await click("Stop recording and transcribe")
    const transcript = await until(() => page(`document.body.innerText.includes('hello from the mock transcriber')`), 10000, 100)
    check("Record/Stop displays the transcript", !!transcript)
    await click("Dismiss transcript")
    mock.behavior.transcriptionFailure = true
    await click("Record voice")
    await until(() => page(`!!document.querySelector('[aria-label="Stop recording and transcribe"]')`), 5000, 100)
    await sleep(1200)
    await click("Stop recording and transcribe")
    check("voice transcription failure appears inline", !!await until(() => page(`!!document.querySelector('[aria-label="Dismiss error"]')`), 10000, 100))
    await click("Dismiss error")
    mock.behavior.transcriptionFailure = false
    await click("Record voice")
    await until(() => page(`!!document.querySelector('[aria-label="Stop recording and transcribe"]')`), 5000, 100)
    await sleep(1200)
    await click("Stop recording and transcribe")
    check("voice recording retries after transcription failure", !!await until(() => page(`document.body.innerText.includes('hello from the mock transcriber')`), 10000, 100))
    await click("Dismiss transcript")
  }

  if (sourceRoot) {
  await click("Settings")
  await click("General")
  // macOS renders <select> menus natively, outside synthetic input; drive the control's change event.
  await page(`(() => { const select = [...document.querySelectorAll('select')].find(el => [...el.labels].some(l => l.textContent.includes('Theme'))); const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; setter.call(select, 'light'); select.dispatchEvent(new Event('change', {bubbles:true})); })()`)
  const light = await until(() => page(`document.documentElement.dataset.theme === 'light'`), 5000, 100)
  check("theme changes to light through the settings control", !!light)
  const lightHover = await hoverColors()
  check("light theme capsule hover stays readable", readable(lightHover), JSON.stringify(lightHover))
  const colors = await page(`(() => { const el = document.querySelector('[aria-label="Search settings"]'); const s = getComputedStyle(el); return {text:s.color,fill:s.webkitTextFillColor,background:s.backgroundColor}; })()`)
  check("light theme input uses dark text", colors.text === "rgb(16, 20, 24)" && colors.fill === colors.text, JSON.stringify(colors))
  await click("Search settings")
  await type("synthetic search")
  check("settings field accepts native typing", await page(`document.querySelector('[aria-label="Search settings"]').value === 'synthetic search'`))
  await page(`document.querySelector('[aria-label="Search settings"]').select()`)
  await key("Backspace")
  check("settings search clears before shortcut checks", await page(`document.querySelector('[aria-label="Search settings"]').value === ''`))
  await click("Restore defaults")
  check("reset requires inline confirmation", await page(`document.body.innerText.includes('Click restore again to confirm.')`))
  await click("Restore defaults")
  check("reset reports disk save completion", !!await until(() => page(`document.body.innerText.includes('Settings saved to disk.')`), 5000, 100))
  await page(`window.electronAPI.setSettings({ai:{providers:{bitecodes:{endpoint:${JSON.stringify(mock.origin)}}}},general:{theme:'dark'}})`)
  await main(`(() => { const r=globalThis.__testRequire; const helper=r(r('path').join(r('electron').app.getAppPath(),'dist-electron/main.js')).AppState.getInstance().shortcutsHelper; const get=helper.getSnapshot.bind(helper); let fail=true; helper.getSnapshot=()=>{ if(fail){fail=false;throw new Error('Synthetic shortcut load failure')} return get() }; })()`)
  await click("Shortcuts")
  check("shortcut load failure appears inline", !!await until(() => page(`document.body.innerText.includes('Synthetic shortcut load failure')`), 5000, 100))
  await click("Retry")
  const shortcutsRecovered = !!await until(() => page(`!document.body.innerText.includes('Synthetic shortcut load failure') && document.body.innerText.includes('Active')`), 5000, 100)
  check("shortcut load retries successfully", shortcutsRecovered, shortcutsRecovered ? "" : await page(`document.body.innerText`))
  await click("Shortcuts")
  await key("Right")
  const tabNavigation = await until(() => page(`(() => { const selected = document.querySelector('[role="tab"][aria-selected="true"]').textContent.trim(); const focused = document.activeElement; return selected === 'Window' && focused.getAttribute('role') === 'tab' && focused.textContent.trim() === 'Window'; })()`), 5000, 100)
  check("settings tabs support keyboard navigation", !!tabNavigation, tabNavigation ? "" : await page(`JSON.stringify({selected:document.querySelector('[role="tab"][aria-selected="true"]').textContent.trim(),focused:document.activeElement.outerHTML})`))
  await click("Settings")
  }

  if (sourceRoot) {
    await win(`w.webContents.send('initial-start')`)
    await until(() => page(`document.body.innerText.includes('Solution') || document.body.innerText.includes('Approach')`), 5000, 100)
    await win(`w.webContents.send('solution-error','Synthetic solution failure')`)
    check("solution failure is visible inline", !!await until(() => page(`document.body.innerText.includes('Processing failed.')`), 5000, 100))
    await click("Return to queue")
    await win(`w.webContents.send('initial-start')`)
    await until(() => page(`document.body.innerText.includes('Solution') || document.body.innerText.includes('Approach')`), 5000, 100)
    const solution = { old_code: "print('synthetic-old')", new_code: "print('synthetic-new')", thoughts: ["Synthetic debug explanation"], time_complexity: "O(1)", space_complexity: "O(1)" }
    await win(`w.webContents.send('debug-success',${JSON.stringify({ solution })})`)
    check("debug result renders from the cache", !!await until(() => page(`document.body.innerText.includes('Synthetic debug explanation')`), 5000, 100))
    await win(`w.webContents.send('debug-start')`)
    await win(`w.webContents.send('debug-error','Synthetic debug failure')`)
    check("debug failure keeps the previous result visible", !!await until(() => page(`!!document.querySelector('[role="alert"]') && document.body.innerText.includes('Synthetic debug explanation')`), 5000, 100))
    solution.thoughts = ["Synthetic replacement explanation"]
    await win(`w.webContents.send('debug-success',${JSON.stringify({ solution })})`)
    check("a later debug success replaces stale output", !!await until(() => page(`document.body.innerText.includes('Synthetic replacement explanation') && !document.body.innerText.includes('Synthetic debug explanation')`), 5000, 100))
    await win(`w.webContents.send('reset-view')`)
  }

  // --- Global shortcuts ---------------------------------------------------------
  const sc = await page("window.electronAPI.getShortcuts()")
  const states = Object.entries(sc?.status ?? {})
  const bad = states.filter(([, s]) => s === "os-conflict" || s === "duplicate")
  check("global shortcuts registered", states.length > 0 && bad.length === 0, bad.length ? JSON.stringify(bad) : `${states.filter(([, s]) => s === "active").length} active`)

  // --- Window controls ------------------------------------------------------------
  const x0 = await win("w.getBounds().x")
  await page("window.electronAPI.moveWindowRight()")
  await sleep(500)
  const x1 = await win("w.getBounds().x")
  check("move window shortcut moves it", typeof x0 === "number" && x1 > x0, `${x0} → ${x1}`)
  await main(`(() => { const r = process.mainModule.require; const m = r(r("path").join(r("electron").app.getAppPath(), "dist-electron", "main.js")); m.AppState.getInstance().toggleMainWindow(); return true })()`)
  const hidden = await until(async () => (await win("w.isVisible()")) === false, 5000, 250)
  await main(`(() => { const r = process.mainModule.require; const m = r(r("path").join(r("electron").app.getAppPath(), "dist-electron", "main.js")); m.AppState.getInstance().toggleMainWindow(); return true })()`)
  const shown = await until(async () => (await win("w.isVisible()")) === true, 5000, 250)
  check("hide / show window", !!hidden && !!shown)
  const prot = await page("window.electronAPI.getSettings().then((s) => s.window.contentProtection)")
  check("content protection setting on", prot === true, String(prot))

  // --- Update check -----------------------------------------------------------------
  const upd = await page("window.electronAPI.updateCheck()")
  check("update check runs", upd?.checkedAt != null && upd.updateRequired === false, JSON.stringify({ latest: upd?.latestVersion }))

  // --- Sign out ------------------------------------------------------------------
  await page("window.electronAPI.bitecodesLogout()")
  await sleep(1000)
  const after = await page(`new Promise((res) => window.electronAPI.chatStream("hi", { onDone: () => res("ANSWERED"), onError: (e) => res(String(e)) }))`)
  check("sign out locks AI again", /Sign in with Bitecodes/.test(after ?? ""), String(after).slice(0, 60))
  check("sign out revokes on the server", sent("/api/v1/desktop/logout").length >= 1)

  if (sourceRoot) {
    await page(`window.electronAPI.setSettings({general:{theme:'light'}})`)
    await until(() => page(`window.electronAPI.getSettingsPersistenceStatus().then(s => s.state === 'saved')`), 5000, 100)
  }
  const alive = await win("!!w && !w.webContents.isCrashed()")
  check("no crash during the run", alive === true && !exited)
  await main(`setTimeout(() => process.mainModule.require("electron").app.quit(), 100); true`).catch(() => {})
  await until(async () => !!exited, 15_000, 500)
  check("quits cleanly", !!exited && (exited.code === 0 || exited.code === null), JSON.stringify(exited))
  if (sourceRoot && exited) {
    exited = null
    child = spawn(exe, [...entry, `--user-data-dir=${profile}`, `--inspect=127.0.0.1:${MAIN}`, ...extra], {
      stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_ENV: "production" },
    })
    child.stdout.on("data", d => { output += d })
    child.stderr.on("data", d => { output += d })
    child.on("exit", (code, signal) => { exited = { code, signal } })
    const restored = await until(() => page(`window.electronAPI.getSettings().then(s => s.general.theme === 'light' && s.ai.providers.bitecodes.endpoint === ${JSON.stringify(mock.origin)})`), 15000, 100)
    check("settings survive a fresh process relaunch", !!restored)
    check("logout remains durable after relaunch", await page(`window.electronAPI.bitecodesStatus().then(s => s.phase === 'signed-out')`))
    await main(`setTimeout(() => globalThis.__testRequire('electron').app.quit(),100); true`)
    await until(async () => !!exited, 15000, 100)
    check("relaunched app quits cleanly", exited?.code === 0)
  }
} catch (error) {
  check("feature test ran", false, String(error?.message ?? error))
  if (sourceRoot) {
    console.error(await page(`JSON.stringify({text:document.body.innerText,active:document.activeElement?.outerHTML,tabs:[...document.querySelectorAll('[role="tab"]')].map(el=>({text:el.textContent,selected:el.getAttribute('aria-selected'),rect:el.getBoundingClientRect().toJSON()})),size:[innerWidth,innerHeight]})`).catch(() => "renderer unavailable"))
    console.error(output.split('\n').filter(line => !/Debugger|For help/.test(line)).slice(-30).join('\n'))
  }
} finally {
  if (!exited) {
    child.kill("SIGKILL")
    await sleep(500)
  }
  mock.close()
  const fatal = output.split("\n").filter((l) => /uncaught|fatal|cannot find module|render-process-gone/i.test(l))
  check("no fatal errors in app output", fatal.length === 0, fatal.slice(0, 3).join(" | "))
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {}
  const failed = results.filter((r) => !r.ok).length
  console.log(`\n${results.length - failed}/${results.length} feature checks passed`)
  process.exit(failed ? 1 : 0)
}
