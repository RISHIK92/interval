// Stages what goes into the VSIX in dist/vsix: the bundle, the README and the manifest.
// vsce refuses a scoped "name", and the workspace needs "@interval/vscode", so the
// staged manifest carries the extension's own name and nothing that only pnpm reads.
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const stage = join(root, "dist", "vsix");

const manifest = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
) as Record<string, unknown>;
delete manifest["scripts"];
delete manifest["dependencies"];
delete manifest["devDependencies"];
manifest["name"] = "interval";

rmSync(stage, { recursive: true, force: true });
mkdirSync(join(stage, "dist"), { recursive: true });
writeFileSync(
  join(stage, "package.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
copyFileSync(join(root, "README.md"), join(stage, "README.md"));
copyFileSync(
  join(root, "dist", "extension.js"),
  join(stage, "dist", "extension.js"),
);
