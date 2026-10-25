import { afterEach, expect, test, vi } from "vitest";
import { logMailer } from "./log-mailer";

afterEach(() => {
  vi.restoreAllMocks();
});

// Q-P1-33: in development, auth email goes to the log instead of being sent.
test("a mail becomes one JSON log line with its recipient, subject and text", async () => {
  const written: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  await logMailer().send({
    to: "ada@example.test",
    subject: "Reset your password",
    text: "Open http://localhost:3100/api/auth/reset-password/abc",
  });
  expect(written).toHaveLength(1);
  expect(JSON.parse(written[0] ?? "")).toMatchObject({
    level: "info",
    msg: "mail: logged instead of sent",
    to: "ada@example.test",
    subject: "Reset your password",
    text: "Open http://localhost:3100/api/auth/reset-password/abc",
  });
});
