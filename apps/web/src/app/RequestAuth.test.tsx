// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AuthState } from "./form";
import { LANDED_MS, RequestAuth } from "./RequestAuth";

// Design trial 3 (owner, 2026-11-27): signing in and creating an account as a request
// through a system.
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
const assign = vi.fn<(url: string) => void>();
const replaceState = vi.fn();

beforeEach(() => {
  // Each frame comes a long while after the last, so the packet lands at once.
  vi.stubGlobal("requestAnimationFrame", (step: FrameRequestCallback) =>
    setTimeout(() => {
      step(performance.now() + 10_000);
    }, 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    clearTimeout(id);
  });
  vi.spyOn(window.history, "replaceState").mockImplementation(replaceState);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { assign },
  });
});
afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  assign.mockReset();
  replaceState.mockReset();
});

type Action = (state: AuthState, form: FormData) => Promise<AuthState>;

function mount(
  initial: "signin" | "signup",
  signIn: Action,
  create: Action,
  extra: { code?: string; reset?: boolean } = {},
) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root.render(
      <RequestAuth
        initial={initial}
        signIn={signIn}
        create={create}
        createPath="/join"
        {...extra}
      />,
    );
  });
}

const input = (id: string) =>
  host.querySelector<HTMLInputElement>(`#request-${id}`);
const text = () => host.textContent;

async function type(id: string, value: string) {
  const el = input(id);
  if (el === null) throw new Error(`no ${id} field`);
  // React tracks a field's value through the prototype's setter, so typing goes
  // through it too.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await Promise.resolve();
  });
}

async function submit() {
  const form = host.querySelector("form");
  await act(async () => {
    form?.requestSubmit();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const never: Action = () => new Promise(() => undefined);

test("an invalid request is not sent, and says what's missing", async () => {
  const signIn = vi.fn<Action>();
  mount("signin", signIn, never);
  await type("email", "ada@");
  await submit();
  expect(signIn).not.toHaveBeenCalled();
  expect(text()).toContain("Enter an email like name@company.com.");
  expect(input("email")?.getAttribute("aria-invalid")).toBe("true");
});

test("each filled field moves the log on", async () => {
  mount("signin", never, never);
  expect(text()).toContain("waiting for email");
  await type("email", "ada@example.test");
  expect(text()).toContain("routed to auth");
  await type("password", "x");
  expect(text()).toContain("credentials ready");
});

test("a wrong password stops at auth with a 401 and the reset link", async () => {
  mount(
    "signin",
    () => Promise.resolve({ message: "Email or password is incorrect." }),
    never,
  );
  await type("email", "ada@example.test");
  await type("password", "wrong one");
  await submit();
  expect(text()).toContain("401");
  expect(text()).toContain("Stopped at auth");
  expect(text()).toContain("Email or password is incorrect.");
  expect(
    host.querySelector('[role="alert"] a[href="/forgot-password"]'),
  ).not.toBeNull();
  expect(assign).not.toHaveBeenCalled();
});

test("a signed-in request shows 200 OK, then opens the next page by itself", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout"] });
  mount("signin", () => Promise.resolve({ next: "/" }), never);
  await type("email", "ada@example.test");
  await type("password", "correct horse");
  const form = host.querySelector("form");
  await act(async () => {
    form?.requestSubmit();
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(text()).toContain("200");
  expect(text()).toContain("OK · welcome back");
  expect(assign).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LANDED_MS);
  });
  expect(assign).toHaveBeenCalledExactlyOnceWith("/");
});

test("the switch flips to creating an account in place", async () => {
  const create = vi.fn<Action>(() => Promise.resolve({ next: "/onboarding" }));
  mount("signin", never, create, { code: "ABCDE-FGHJK" });
  const flip = [...host.querySelectorAll('[role="group"] button')].at(1);
  await act(async () => {
    flip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
  // An old invite link's code stays in the address.
  expect(replaceState).toHaveBeenCalledWith(null, "", "/join?code=ABCDE-FGHJK");
  // The card names the real route the form posts to.
  expect(text()).toContain("POST/join");
  await type("name", "Ada Lovelace");
  expect(text()).toContain("hello, Ada");
  await type("email", "ada@example.test");
  await type("password", "short");
  expect(text()).toContain("3 more characters");
  await type("password", "longer one 1234");
  expect(text()).toContain("password strong");
  await submit();
  const sent = create.mock.calls[0]?.[1];
  expect(sent?.get("name")).toBe("Ada Lovelace");
  expect(sent?.get("code")).toBe("ABCDE-FGHJK");
  expect(text()).toContain("201");
});

test("a refused sign-up shows the server's reason, with no 401", async () => {
  mount("signup", never, () =>
    Promise.resolve({
      message: "An account with that email already exists. Sign in instead.",
    }),
  );
  await type("name", "Ada");
  await type("email", "ada@example.test");
  await type("password", "long enough");
  await submit();
  expect(text()).toContain("An account with that email already exists.");
  expect(text()).not.toContain("401");
});

test("after a reset, the sign-in card says the password changed", () => {
  mount("signin", never, never, { reset: true });
  expect(text()).toContain("Your password was changed.");
});
