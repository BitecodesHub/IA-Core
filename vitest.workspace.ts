import { defineWorkspace } from "vitest/config"
import react from "@vitejs/plugin-react"
import path from "node:path"

// Two isolated Vitest projects so the fast pure-logic suite never pays the cost
// of jsdom or the React plugin:
//   - node: pure-logic unit tests (*.test.ts), Node environment, no setup.
//   - dom:  React component tests (*.test.tsx), jsdom + Testing Library.
// `npm test` (vitest run) executes both projects automatically.
export default defineWorkspace([
  {
    test: {
      name: "node",
      environment: "node",
      include: ["tests/**/*.test.ts"],
      globals: true,
    },
  },
  {
    plugins: [react()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "src") },
    },
    test: {
      name: "dom",
      environment: "jsdom",
      include: ["tests/**/*.test.tsx"],
      setupFiles: ["tests/setup/dom.ts"],
      globals: true,
    },
  },
])
