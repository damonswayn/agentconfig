const eslintJs = require("@eslint/js");
const typescriptEslint = require("typescript-eslint");
const prettierConfig = require("eslint-config-prettier");

const typeCheckedConfigs = typescriptEslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ["**/*.ts"]
}));

module.exports = typescriptEslint.config(
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  eslintJs.configs.recommended,
  ...typeCheckedConfigs,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "script",
        project: "./tsconfig.json"
      }
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_"
        }
      ],
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            attributes: false
          }
        }
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports"
        }
      ]
    }
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "script",
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly"
      }
    }
  },
  {
    files: ["tests/**/*.js", "scripts/**/*.js"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly"
      }
    }
  },
  prettierConfig
);
