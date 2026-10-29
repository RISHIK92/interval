# 0024. GitHub repository access through a GitHub App; GitHub sign-in deferred

- Status: ACCEPTED (owner, 2026-10-29)
- Date: 2026-10-29
- Supersedes: none (amends ADR-0010 item 2)
- Superseded by: none

## Context

Week 12 of Phase 2 (docs/roadmap/phase-2.md) is "GitHub dependency mapping and project-aware notes, then release."

**What the product and decisions ask for:**

- §5H: "With permission, GitHub provides repository metadata and dependency files (package.json, requirements.txt, go.mod). Dependencies map to concepts through a curated table. Reading actual code requires a separate opt-in."
- §5A: "Connecting GitHub is optional."
- PER-3: "Cold start: onboarding choices, GitHub mapping, and an optional placement quiz."
- PER-4: "A curated table maps technologies to concepts. An LLM can suggest additions, which you review."
- REC-1 lists "projects" among the feed's candidate generators.
- ADR-0015: the goal "Get better at the stack I use" ("Picks tied to your real projects") waits for GitHub mapping.
- C-30 (ADR-0006): projects come from GitHub only, never manual entry.
- The Oct 22 wireframes' privacy panel (UI only, lowest precedence) says every integration, GitHub included, "uses fine-grained, revocable permissions", and that reading code is a separate opt-in.

**The two questions:**

- **How Interval gets read access to a user's repositories.** Dependency files usually live in private repositories, and the read must stay narrow: metadata and the files' contents, never write access, and never more repositories than the user chooses.
- **Whether GitHub is also a sign-in method this week.** ADR-0010 item 2 (ACCEPTED) says: "GitHub becomes a sign-in method in Phase 2 (ADR-0004). GitHub is also the account connection for project features." ADR-0004 had noted that GitHub "is OAuth 2.0 without OIDC", and that treating it "as a separate connection (not a sign-in method) using GitHub's OAuth app flow in the Next.js app ... is simpler and matches §5H, where GitHub is a data permission." ADR-0010 left open how a GitHub sign-in links to an existing email account with the same address.

**Owner decisions (2026-10-29, Week 12 planning):**

- Access is through a GitHub App.
- The connection is made from Profile by a signed-in user.
- GitHub is not a sign-in method this week.
- Code is never read.

This ADR records those decisions and weighs them against the alternatives.

## Options

### A. A GitHub App, installed by the user on the repositories they pick

- **How it works:**
  - Interval registers a GitHub App with read-only "Metadata" and "Contents" repository permissions.
  - From Profile, a signed-in user installs it on all their repositories or only the ones they select. GitHub returns an installation id, which Interval stores against the user.
  - The worker mints short-lived installation tokens (a JWT signed with the App's private key, exchanged for a token that lasts an hour). With them it reads each selected repository's name, description, languages and dependency files.
  - The user changes the selection or uninstalls on GitHub at any time.
  - A "Disconnect" in Profile removes Interval's copy and asks the user to uninstall on GitHub. A webhook can do that automatically later.
- **Pros:**
  - The narrowest access GitHub offers: read-only, per repository, chosen by the user, and revocable on GitHub without Interval's help. That matches §5H's "with permission" and the wireframes' "fine-grained, revocable".
  - No long-lived user token is stored, only an installation id; tokens are minted per sync and expire in an hour.
  - Private repositories work.
  - Organisation repositories work with an organisation owner's approval.
- **Cons:**
  - One more registered app to configure: its app id, its private key (a secret) and its slug. Each deployment mode needs those from env (ADR-0011).
  - Minting tokens needs RS256 JWT signing in the Python worker. That means a new dependency (PyJWT with `cryptography`) or hand-rolled signing, and the dependency needs the owner's approval.
  - Linking an installation to the signed-in user takes care. The install callback carries an `installation_id` that anyone could forge, so Interval must check it, either with a short OAuth step through the App ("request user authorization during installation") or by checking the installation's account against the user's GitHub identity.
- **Cost to reverse:**
  - Moderate. The stored data (repositories, dependencies, mapped concepts) doesn't depend on how it was fetched.
  - Switching to an OAuth app later replaces the connect flow and the token minting only.

### B. An OAuth app reading public repositories only

- **How it works:** "Connect GitHub" runs GitHub's OAuth flow with `read:user` only. Interval lists the user's public repositories and reads their dependency files with the user's token, or without one, since the repositories are public.
- **Pros:**
  - The simplest flow.
  - No private key or JWT; a client id and secret, as Better Auth's GitHub provider would also use.
  - The same flow could later become sign-in (ADR-0010).
- **Cons:**
  - Private repositories, where most working projects live, are invisible. The goal "Get better at the stack I use" then covers only what users publish.
  - A long-lived user token is stored, or none at all, with rate limits for anonymous reads.
- **Cost to reverse:** low. Adding private access later means option A or C anyway.

### C. An OAuth app with the classic `repo` scope

- **How it works:** the same flow as B, asking for the `repo` scope.
- **Pros:** private repositories work, with the same simple flow as B.
- **Cons:**
  - `repo` grants read and write access to all the user's repositories, code and settings included: far more than §5H needs, and the opposite of "fine-grained".
  - A long-lived token with that reach must be stored and protected.
  - Users rightly hesitate to grant it.
- **Cost to reverse:**
  - Low in code.
  - High in trust: tokens already granted keep their reach until users revoke them.

### D. Sign-in with GitHub this week (with A, B or C for access)

- **How it works:** keeps ADR-0010 item 2 as written. Better Auth's GitHub provider signs users in, and the account-linking rule is decided now (link automatically, or after the user confirms with their password).
- **Pros:** fulfils ADR-0010 as accepted; one GitHub identity serves both sign-in and connection.
- **Cons:**
  - It adds the linking rule (ADR-0010's open question), a second identity per account, and guest-merge interactions, all in the week that also carries dependency mapping, project-aware notes and the Phase 2 wrap-up.
  - None of §5H's features need sign-in: a signed-in user connecting from Profile is enough.
- **Cost to reverse:**
  - Accounts created through GitHub sign-in can't be unmade without a migration path.
  - Deferring it costs nothing.

## Recommendation (not a decision)

**A, and defer D:** a GitHub App for repository access, connected from Profile, with no GitHub sign-in this week.

**Why A:**

- §5H's "with permission" and its separate opt-in for code imply access that stops at metadata and dependency files.
- PER-3 and ADR-0015's goal need the user's real projects, which are mostly private. That rules out B.
- C's write-capable `repo` scope contradicts the narrow read §5H describes.
- A is the only option that is read-only, per repository, private-capable and revocable on GitHub.

**Why defer D:** ADR-0004 itself called a separate connection "simpler and matches §5H, where GitHub is a data permission." Deferring sign-in keeps ADR-0010's linking question open until sign-in has a use.

**What would change this:**

- GitHub withdrawing per-repository App installations would.
- The owner wanting GitHub sign-in at launch would bring D back.

## Consequences

**Amends ADR-0010 item 2:** GitHub is a data connection now, not a sign-in method. ADR-0010's open question on account linking stays open until a later ADR brings GitHub sign-in.

**The owner:**

- registers the GitHub App: read-only Metadata and Contents; "Request user authorization (OAuth) during installation" on, so the callback proves which GitHub user installed it; a callback URL per environment;
- supplies `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` and `GITHUB_APP_PRIVATE_KEY` to both deployment modes (ADR-0011): an SSM SecureString on AWS, the env file on the VM.

**Web:**

- a "Connect GitHub" control in Profile, and the install callback;
- a stored installation per user;
- "Disconnect", which deletes Interval's copy of the repositories and dependencies and tells the user to uninstall on GitHub.

**Worker:**

- a `github_sync` stage mints installation tokens and reads each selected repository's metadata and its dependency files (§5H: package.json, requirements.txt, go.mod, and the like);
- it stores repository names and dependency names only, never file contents beyond those names, and never code;
- token minting needs a JWT library (the owner approves the dependency) or standard-library signing.

**Next steps:**

- The PER-4 curated technology-to-concept table and its review flow follow.
- So do the REC-1 projects candidate generator, ADR-0015's goal becoming selectable, and project-aware notes.

**Out of scope:**

- GitHub sign-in;
- reading code (§5H's separate opt-in);
- webhooks: a sync on connect and a scheduled refresh come first.

## Open questions

- **Refresh:** how often are a connected user's repositories re-read? Suggested default: on connect, then daily, plus a "Refresh" button in Profile.
- **Which dependency files:** which files count beyond §5H's three? Suggested default: package.json, requirements.txt, pyproject.toml, go.mod, at a repository's root and one directory down (monorepos), ignoring lockfiles.
- **Organisations:** may repositories owned by organisations be connected? GitHub asks the organisation's owner to approve. Suggested default: yes, when the installation allows it.
- **Token signing:** is a new Python dependency for RS256 JWTs acceptable (PyJWT with `cryptography`)? Or should the worker sign with the `cryptography` package alone, if it is already present?
