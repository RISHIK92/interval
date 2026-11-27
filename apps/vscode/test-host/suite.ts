import assert from "node:assert/strict";
import * as vscode from "vscode";

// Loaded by VS Code's test host (test-host/run.mts), which calls run(); a throw fails it.
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<{
    statusBar: vscode.StatusBarItem;
  }>("interval.interval");
  assert.ok(extension, "the extension is installed");
  const { statusBar } = await extension.activate();

  const commands = await vscode.commands.getCommands(true);
  for (const command of [
    "interval.signIn",
    "interval.signOut",
    "interval.openQuickSession",
  ]) {
    assert.ok(commands.includes(command), `${command} is registered`);
  }

  // The first check reads SecretStorage, which is empty in a fresh profile.
  const deadline = Date.now() + 10_000;
  while (
    statusBar.text !== "$(book) Interval: sign in" &&
    Date.now() < deadline
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(statusBar.text, "$(book) Interval: sign in");
  assert.equal(typeof statusBar.tooltip, "string");
  assert.match(statusBar.tooltip as string, /Interval: Sign in/);
  assert.equal(statusBar.command, "interval.openQuickSession");
}
