import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Labels are translated, so code must never decide from one (docs/i18n.md).
const DECIDE_BY_ID = "Decide by id or value; labels are translated (docs/i18n.md)";
const TRANSLATED_CALL =
  'CallExpression:matches([callee.name=/^(t|tAll)$/], [callee.type="CallExpression"][callee.callee.name="clientTranslator"])';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: `BinaryExpression[operator=/^[!=]==?$/]:has(> ${TRANSLATED_CALL})`,
          message: DECIDE_BY_ID,
        },
        {
          selector: `CallExpression[callee.property.name="includes"]:has(> ${TRANSLATED_CALL})`,
          message: DECIDE_BY_ID,
        },
        {
          selector:
            'BinaryExpression[operator=/^[!=]==?$/]:has(> MemberExpression[property.name="label"]):has(> Literal[value=/./])',
          message: DECIDE_BY_ID,
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
