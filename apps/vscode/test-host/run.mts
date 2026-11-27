// Runs test-host/suite.ts inside a real VS Code (downloaded by @vscode/test-electron
// into .vscode-test) against the staged extension, with a fresh profile: no token in
// SecretStorage, no other extensions, and a site set so the label is the signed-out one.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const profile = mkdtempSync(join(tmpdir(), "interval-vscode-"));
mkdirSync(join(profile, "User"));
writeFileSync(
  join(profile, "User", "settings.json"),
  JSON.stringify({ "interval.url": "https://interval.example" }),
);
try {
  await runTests({
    extensionDevelopmentPath: join(root, "dist", "vsix"),
    extensionTestsPath: join(root, "dist", "test-host", "suite.js"),
    launchArgs: [
      "--disable-extensions",
      "--user-data-dir",
      profile,
      // A machine without a keyring (CI, a headless Linux) still gets SecretStorage.
      "--password-store=basic",
    ],
  });
} finally {
  rmSync(profile, { recursive: true, force: true });
}
