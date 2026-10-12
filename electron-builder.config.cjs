// electron-builder config: package.json "build", upgraded automatically to
// fully trusted builds when real certificates are provided — no code change.
//
// macOS (removes "Apple could not verify…" entirely):
//   CSC_LINK / CSC_KEY_PASSWORD  – Developer ID Application certificate (.p12)
//   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID – for notarization
// Windows (removes the SmartScreen "unknown publisher" warning over time):
//   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET plus
//   NOTES_AZURE_ENDPOINT, NOTES_AZURE_ACCOUNT, NOTES_AZURE_PROFILE – Trusted Signing
//
// Without them, Macs get the stable self-signed signature (scripts/adhoc-sign.cjs)
// and Windows builds are unsigned, exactly as before.
const base = require("./package.json").build

const appleReady = Boolean(process.env.CSC_LINK && process.env.APPLE_ID && process.env.APPLE_TEAM_ID)
const azureReady = Boolean(
  process.env.AZURE_TENANT_ID && process.env.NOTES_AZURE_ENDPOINT && process.env.NOTES_AZURE_ACCOUNT && process.env.NOTES_AZURE_PROFILE
)

const config = JSON.parse(JSON.stringify(base))

if (appleReady) {
  delete config.afterPack // electron-builder signs with the Developer ID itself
  config.mac.identity = undefined // pick the Developer ID from CSC_LINK
  config.mac.hardenedRuntime = true // required for notarization
  config.mac.entitlements = "assets/entitlements.mac.plist"
  config.mac.entitlementsInherit = "assets/entitlements.mac.plist"
  config.mac.notarize = true
  config.mac.gatekeeperAssess = false
}

if (azureReady) {
  config.win.azureSignOptions = {
    endpoint: process.env.NOTES_AZURE_ENDPOINT,
    codeSigningAccountName: process.env.NOTES_AZURE_ACCOUNT,
    certificateProfileName: process.env.NOTES_AZURE_PROFILE,
  }
}

console.log(
  `[build] signing: macOS ${appleReady ? "Developer ID + notarization" : "stable self-signed"}, ` +
    `Windows ${azureReady ? "Azure Trusted Signing" : "unsigned"}`
)

module.exports = config
