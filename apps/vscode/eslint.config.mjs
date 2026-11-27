import shared from "@interval/config/eslint";
import { defineConfig } from "eslint/config";

// P7-W47: the repo's type-checked rules; the bundles and the downloaded VS Code used by
// the test host are not ours to lint.
export default defineConfig(shared, {
  ignores: ["dist/**", ".vscode-test/**"],
});
