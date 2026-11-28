import type { AgentStatus } from "@interval/api-client";
import * as vscode from "vscode";
import { DEVICE_TOKEN, fetchStatus, type StatusResult } from "./api";
import { Poller } from "./poller";
import { choices } from "./session";
import { homeUrl, readSite, type Site } from "./site";
import { type BarState, show } from "./view";

// P7-W47 (§7; Q-P7-03, owner 2026-11-20 and 2026-11-27): the agent's status in the status
// bar and a quick session in the browser, read from GET /api/agent/status with the
// hook's device token. The extension reads nothing of the editor, the workspace or a
// terminal, and sends nothing but that request.

// SecretStorage only: never settings or globalState, which sync and sit in plain files.
const TOKEN_KEY = "interval.deviceToken";
const SIGN_IN = "interval.signIn";
const QUICK_SESSION = "interval.openQuickSession";

type Ready = { readonly site: Site; readonly token: string };
type Unready = Extract<BarState, { kind: "noSite" | "badSite" | "signedOut" }>;
type Checked =
  { readonly ready: Ready; readonly result: StatusResult } | Unready;

// The test host reads the item's text through the extension's exports.
export function activate(context: vscode.ExtensionContext): {
  readonly statusBar: vscode.StatusBarItem;
} {
  const item = vscode.window.createStatusBarItem(
    "interval.status",
    vscode.StatusBarAlignment.Right,
  );
  item.name = "Interval";
  item.command = QUICK_SESSION;
  const output = vscode.window.createOutputChannel("Interval", { log: true });
  let shown: BarState["kind"] = "checking";
  const render = (state: BarState): void => {
    shown = state.kind;
    const { text, tooltip } = show(state);
    item.text = text;
    item.tooltip = tooltip;
  };
  // The last status that came back, for a click while Interval has asked for no
  // requests (a 429); forgotten when the site or the token changes.
  let lastGood: { site: Site; status: AgentStatus } | undefined;
  // The refusal already announced, so a click that got it doesn't announce it again.
  let announced: StatusResult | undefined;

  const ready = async (): Promise<Ready | Unready> => {
    const config = vscode.workspace.getConfiguration("interval");
    const setting = readSite(config.get<string>("url", ""));
    if (setting.kind === "unset") return { kind: "noSite" };
    if (setting.kind === "refused")
      return { kind: "badSite", reason: setting.reason };
    const token = await context.secrets.get(TOKEN_KEY);
    if (token === undefined) return { kind: "signedOut" };
    return { site: setting.site, token };
  };

  const poller = new Poller<Checked>(
    {
      run: async () => {
        const settings = await ready();
        if (!("token" in settings)) return settings;
        return {
          ready: settings,
          result: await fetchStatus(fetch, settings.site, settings.token),
        };
      },
      resultOf: (checked) => ("result" in checked ? checked.result : null),
      show: (checked) => {
        if (!("result" in checked)) {
          render(checked);
          return;
        }
        const { result } = checked;
        if (result.kind === "ok") {
          lastGood = { site: checked.ready.site, status: result.status };
        }
        // A refused token is said once, when it happens, with a way to fix it; after
        // that only the tooltip says it.
        if (result.kind === "refused" && shown !== "refused") {
          announced = result;
          void explain(result);
        }
        render(result);
      },
      log: (message) => {
        output.error(message);
      },
    },
    vscode.window.state.focused,
  );
  const restart = (newToken: boolean): void => {
    lastGood = undefined;
    poller.restart({ newToken });
  };

  context.subscriptions.push(
    item,
    output,
    poller,
    vscode.window.onDidChangeWindowState((state) => {
      poller.setFocused(state.focused);
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("interval")) restart(false);
    }),
    context.secrets.onDidChange((event) => {
      if (event.key === TOKEN_KEY) restart(true);
    }),
    vscode.commands.registerCommand(SIGN_IN, async () => {
      const token = await vscode.window.showInputBox({
        title: "Interval: Sign in",
        prompt: "Paste a device token made on Interval's Profile → Agent hook.",
        placeHolder: "ivd_…",
        password: true,
        ignoreFocusOut: true,
        validateInput: (value) =>
          DEVICE_TOKEN.test(value.trim())
            ? undefined
            : "That isn't a device token: it starts with ivd_ and is 47 characters long.",
      });
      if (token === undefined) return;
      await context.secrets.store(TOKEN_KEY, token.trim());
      void vscode.window.showInformationMessage("Signed in to Interval.");
    }),
    vscode.commands.registerCommand("interval.signOut", async () => {
      await context.secrets.delete(TOKEN_KEY);
      void vscode.window.showInformationMessage(
        "Signed out of Interval. Revoke the device on your Profile if you won't use it again.",
      );
    }),
    vscode.commands.registerCommand(QUICK_SESSION, async () => {
      // Through the poller: it joins a check in flight, and sends nothing while a
      // 429's wait lasts.
      const checked = await poller.now();
      if (checked !== "held" && checked !== undefined) {
        if (!("result" in checked)) {
          await explain(checked);
          return;
        }
        const { result } = checked;
        if (result.kind === "ok") {
          await offer(checked.ready.site, result.status);
          return;
        }
        if (result.kind !== "rateLimited") {
          if (result !== announced) await explain(result);
          return;
        }
      }
      // No answer now (a 429, or the check went stale or failed, which the Output
      // panel has): the last one's suggestions, else Home.
      if (lastGood !== undefined) {
        await offer(lastGood.site, lastGood.status);
        return;
      }
      const settings = await ready();
      if (!("token" in settings)) {
        await explain(settings);
        return;
      }
      await open(homeUrl(settings.site));
    }),
  );
  render({ kind: "checking" });
  item.show();
  poller.start();
  return { statusBar: item };
}

async function offer(site: Site, status: AgentStatus): Promise<void> {
  const picks = choices(status, site);
  if (picks.length === 0) {
    await open(homeUrl(site));
    return;
  }
  const picked = await vscode.window.showQuickPick(picks, {
    title: "Interval: a quick session",
    placeHolder: "Read while you wait",
  });
  if (picked !== undefined) await open(picked.url);
}

async function open(url: string): Promise<void> {
  // strict: throw on a missing scheme rather than guessing file:.
  const opened = await vscode.env.openExternal(vscode.Uri.parse(url, true));
  if (!opened) void vscode.window.showWarningMessage(`Couldn't open ${url}.`);
}

// A command the user ran answers in a message, unlike the poll's tooltip.
async function explain(state: BarState): Promise<void> {
  switch (state.kind) {
    case "noSite":
    case "badSite": {
      const picked = await vscode.window.showWarningMessage(
        state.kind === "noSite"
          ? "Set interval.url to your Interval site."
          : state.reason,
        "Open settings",
      );
      if (picked !== undefined) {
        await vscode.commands.executeCommand(
          "workbench.action.openSettings",
          "interval.url",
        );
      }
      return;
    }
    case "signedOut":
    case "refused": {
      const picked = await vscode.window.showInformationMessage(
        state.kind === "signedOut"
          ? "Sign in to Interval with a device token from your Profile."
          : "Interval refused the device token (revoked?). Sign in with a new one.",
        "Sign in",
      );
      if (picked !== undefined) await vscode.commands.executeCommand(SIGN_IN);
      return;
    }
    default:
      void vscode.window.showWarningMessage(show(state).tooltip);
  }
}
