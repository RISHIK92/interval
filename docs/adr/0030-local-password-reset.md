# 0030. Password reset without a link, on this machine only

- Status: PROPOSED
- Date: 2026-10-31
- Supersedes: ADR-0004, its reset flow for requests made on localhost only
- Superseded by: none

## Context

ADR-0004 and Q-P1-33 give password reset an emailed link, valid for an hour, used once. Q-P1-33: "Auth email: local log in development, SES at beta." No SES adapter exists yet (`MAIL_TRANSPORT` has only `log`), so the link lands in the dev server log and "Forgot password" can't be finished from the page. The owner asked (2026-10-31) to replace it, for now, with a reset that needs no verification. The dev server is also public through an ngrok tunnel, so a reset by email alone, open to every request, lets anyone who knows an address take that account, the owner's admin account included.

## Options

### A. Email-only reset, on requests made on this machine

The forgot page asks for an email and a new password when the request comes straight to localhost (Host `localhost`, `127.0.0.1` or `[::1]`, any `x-forwarded-host` the same, every `x-forwarded-for` address loopback). The new password replaces the old one and ends every session. Any other request (ngrok sends its own Host and the visitor's address) keeps the link flow.

- Pros: works today with no mail service; the tunnel can't reach it.
- Cons: anyone at this machine can reset any account; an unknown email says so. Headers can't prove where a request came from: `next dev` listens on every address and Next keeps a client's own `x-forwarded-for`, so a machine on the same network can claim to be loopback (the reviewer reproduced it). Binding the dev server to loopback would close it; the owner declined (2026-10-31: "I'm only the one using the ngrok link"), accepting the risk. Safe from the tunnel only while ngrok adds the visitor's address (its default; `--request-header-remove X-Forwarded-For` with `--host-header=rewrite` would open it).
- Cost to reverse: delete the local branch in the forgot page and action, `isLocalRequest` and `Accounts.setPassword`.

### B. Email-only reset for every request

- Pros: testers on the tunnel can use it too.
- Cons: any visitor can take any account by its address.
- Cost to reverse: as A, after any takeover has happened.

### C. Admin-issued reset link

- Pros: safe anywhere; no mail service.
- Cons: the owner hands each link over by hand; not what the owner asked for.
- Cost to reverse: small.

## Recommendation (not a decision)

A, as the owner chose it with the risk stated: it meets the request on the machine the owner works at and refuses the tunnel. Testers on the tunnel still get only the link flow, so their resets go through the owner (the logged link) until SES exists.

## Consequences

- `apps/web/src/server/local-request.ts` (`isLocalRequest`), `Accounts.setPassword` in `ports.ts` and `adapters/better-auth.ts`, `quickReset` in `server/accounts.ts`, and the forgot page and action branch on it.
- `/reset-password` and the link flow stay as ADR-0004 has them.
- Fails closed: never in a production build (`NODE_ENV=production`, so the Docker image and VM never offer it), and a request without `x-forwarded-for` isn't local. Setting the password ends every session and voids reset links already sent.
- Before beta (the SES adapter, the pre-deploy list): remove this branch, or keep it only where `MAIL_TRANSPORT=log`.

## Open questions

- Remove it when SES arrives, or keep it for local development behind `MAIL_TRANSPORT=log`?
