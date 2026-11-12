import config from "@interval/config/eslint";
import { defineConfig } from "eslint/config";

// fixtures/ holds reference solutions in five languages, run in the sandbox by the
// generator tests (P5-W29-S02); they are a player's code, not this package's.
export default defineConfig(config, { ignores: ["fixtures/"] });
