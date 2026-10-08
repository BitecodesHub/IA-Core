// electron-builder afterPack hook: ad-hoc sign the macOS app bundle.
//
// Without a Developer ID, electron-builder skips signing and leaves only the
// linker's ad-hoc signature on the main binary. The bundle is then not sealed
// ("code has no resources but signature indicates they must be present"), and
// a copy downloaded in a browser (quarantined) is rejected as "damaged and
// can't be opened" — which right-click → Open cannot bypass. A proper ad-hoc
// signature over the whole bundle, inside-out, turns that into the normal
// "unidentified developer" prompt the user can approve.
//
// Prefer a STABLE self-signed identity (kept in its own keychain, outside the
// repo): its designated requirement is "identifier + certificate", the same
// for every build, so macOS keeps trusting the app's keychain item ("Notes
// Safe Storage") across updates. A pure ad-hoc signature's requirement is the
// code hash, which changes every build — every update would then ask users
// for their keychain password. Ad-hoc is only the fallback (with a warning).
const { execFileSync } = require("node:child_process")
const path = require("node:path")
const fs = require("node:fs")
const os = require("node:os")

const SIGN_DIR = process.env.NOTES_SIGN_DIR || path.join(os.homedir(), ".config", "notes-signing")
const KEYCHAIN = path.join(SIGN_DIR, "notes-signing.keychain-db")

function stableIdentity() {
  try {
    if (!fs.existsSync(KEYCHAIN)) return null
    const pass = fs.readFileSync(path.join(SIGN_DIR, "keychain.pass"), "utf8").trim()
    execFileSync("security", ["unlock-keychain", "-p", pass, KEYCHAIN])
    const out = execFileSync("security", ["find-identity", KEYCHAIN]).toString()
    const m = out.match(/\b([0-9A-F]{40})\b\s+"Bitecodes Notes Code Signing"/)
    return m ? m[1] : null
  } catch {
    return null
  }
}

let IDENTITY = null
function sign(target, entitlements) {
  const args = ["--force", "--sign", IDENTITY ?? "-", "--timestamp=none"]
  if (IDENTITY) args.push("--keychain", KEYCHAIN)
  if (entitlements) args.push("--entitlements", entitlements)
  execFileSync("codesign", [...args, target], { stdio: "inherit" })
}

/** Every nested code object, deepest first, so outer seals cover signed inners. */
function nestedCode(dir) {
  const out = []
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name)
      const st = fs.lstatSync(p)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) {
        walk(p)
        if (/\.(app|framework|xpc|appex)$/.test(name)) out.push(p)
      } else if (/\.(dylib|node|so)$/.test(name) || (st.mode & 0o111 && !/\.(sh|js|json|plist|txt)$/.test(name) && isMachO(p))) {
        out.push(p)
      }
    }
  }
  walk(dir)
  return out.sort((a, b) => b.split(path.sep).length - a.split(path.sep).length)
}

function isMachO(file) {
  try {
    const fd = fs.openSync(file, "r")
    const buf = Buffer.alloc(4)
    fs.readSync(fd, buf, 0, 4, 0)
    fs.closeSync(fd)
    const m = buf.readUInt32BE(0)
    return [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(m)
  } catch {
    return false
  }
}

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== "darwin") return
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`)
  const entitlements = path.join(context.packager.projectDir, "assets", "entitlements.mac.plist")
  IDENTITY = stableIdentity()
  if (!IDENTITY) {
    console.warn("  ⚠ no stable signing identity found — ad-hoc signing; every update will prompt for keychain access")
  }
  const frameworks = path.join(app, "Contents", "Frameworks")
  for (const item of nestedCode(frameworks)) sign(item)
  sign(app, fs.existsSync(entitlements) ? entitlements : undefined)
  execFileSync("codesign", ["--verify", "--deep", "--strict", app], { stdio: "inherit" })
  console.log(`  • signed (${IDENTITY ? "stable self-signed identity" : "ad-hoc"}) and verified ${path.basename(app)}`)
}
