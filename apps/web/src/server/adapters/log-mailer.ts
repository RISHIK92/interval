import { log } from "../log";
import type { Mailer } from "../ports";

// Q-P1-33: auth email goes to the log in development. env() allows this transport only
// for a local site, because the text carries reset links.
export function logMailer(): Mailer {
  return {
    send: (mail) => {
      log.info("mail: logged instead of sent", mail);
      return Promise.resolve();
    },
  };
}
