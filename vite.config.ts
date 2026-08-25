import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"

// The renderer is a standard root-index.html Vite app. The Electron main/preload
// are compiled separately via `tsc -p electron/tsconfig.json`, so this config only
// concerns the renderer bundle.
//
// `base: "./"` is required: in production the window loads `file://.../dist/index.html`,
// and relative asset URLs are the only ones that resolve under the file: protocol.
export default defineConfig({
  root: path.resolve(__dirname),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    // Bind the IPv4 loopback explicitly: on Windows, Node may resolve
    // "localhost" to ::1 first, which desyncs Vite's bind address from the
    // address Electron and wait-on connect to. Everything (this bind, the
    // wait-on gate in electron:dev, and startUrl in WindowHelper) uses
    // 127.0.0.1:5180 so they can never disagree.
    host: "127.0.0.1",
    port: 5180,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "chrome120", // matches the bundled Electron 33 Chromium
  },
  clearScreen: false,
})
