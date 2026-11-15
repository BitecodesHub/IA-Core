const { execFileSync } = require("node:child_process")
const fs = require("node:fs")
const path = require("node:path")

// Build-time only. Non-macOS builds never need or invoke the helper.
if (process.platform === "darwin") {
  const root = path.resolve(__dirname, "..")
  const source = path.join(root, "electron", "mac-text-actions.m")
  const outputDir = path.join(root, "dist-electron")
  const output = path.join(outputDir, "mac-text-actions")
  fs.mkdirSync(outputDir, { recursive: true })
  const arm64 = path.join(outputDir, ".mac-text-actions-arm64")
  const x64 = path.join(outputDir, ".mac-text-actions-x86_64")
  const universal = path.join(outputDir, `.mac-text-actions-${process.pid}-universal`)
  try {
    // Avoid per-link variation and temporary-name thin-slice signatures; the
    // unchanged helper must have identical bytes in both universal app halves.
    for (const [arch, target] of [
      ["arm64", arm64],
      ["x86_64", x64],
    ]) {
      execFileSync(
        "xcrun",
        [
          "clang",
          "-arch",
          arch,
          "-mmacosx-version-min=11.0",
          "-fobjc-arc",
          "-O2",
          "-Wall",
          "-Wextra",
          "-Werror",
          "-Wl,-no_adhoc_codesign,-reproducible",
          source,
          "-framework",
          "AppKit",
          "-framework",
          "ApplicationServices",
          "-o",
          target,
        ],
        { stdio: "inherit", shell: false }
      )
    }
    execFileSync("xcrun", ["lipo", "-create", arm64, x64, "-output", universal], {
      stdio: "inherit",
      shell: false,
    })
    // Use a fixed identifier on both slices rather than inheriting clang's
    // temporary output filename. Packaging replaces this ad-hoc signature
    // with the configured identity, retaining the helper's stable identifier.
    execFileSync(
      "codesign",
      [
        "--force",
        "--sign",
        "-",
        "--identifier",
        "com.notes.desktop.mac-text-actions",
        "--timestamp=none",
        universal,
      ],
      { stdio: "inherit", shell: false }
    )
    fs.chmodSync(universal, 0o755)
    fs.renameSync(universal, output)
    console.log("Built universal macOS text-actions helper.")
  } finally {
    for (const file of [arm64, x64, universal]) fs.rmSync(file, { force: true })
  }
}
