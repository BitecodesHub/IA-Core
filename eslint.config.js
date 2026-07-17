// Flat ESLint config (ESLint v9+). Kept intentionally lean: type-aware linting
// is expensive and this codebase favors fast feedback. Correctness is enforced
// primarily by `tsc`; ESLint catches stylistic and obvious-bug issues.
const js = require("@eslint/js")
const tseslint = require("typescript-eslint")

module.exports = [
  {
    ignores: [
      "dist/**",
      "dist-electron/**",
      "release/**",
      "node_modules/**",
      "worker-script/**",
      "*.config.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-require-imports": "off",
      "no-empty": ["warn", { allowEmptyCatch: true }],
    },
  },
]
