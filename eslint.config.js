const js = require("@eslint/js")
const tseslint = require("typescript-eslint")
const globals = require("globals")

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
      globals: {
        ...globals.node,
        ...globals.browser,
      },
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

