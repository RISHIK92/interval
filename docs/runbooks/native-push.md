# Native push: turning it on (P4-W19-S04b)

Base64 on one line: `base64 -i FILE` on macOS, `base64 -w0 FILE` on Linux (a wrapped value is refused).

The worker sends straight to Apple's APNs and Google's FCM (Q-P4-03), with no Expo push service. Until these secrets hold real values, native push is off, logged as "push: APNs off" / "push: FCM off".

## Apple (iOS)

1. In the Apple Developer account: Certificates, Identifiers & Profiles → Keys → create a key with "Apple Push Notifications service (APNs)". Download the `.p8` file (once only) and note its Key ID and your Team ID.
2. Store them:
   - VM: `interval/prod/apns-key` = `base64 -i AuthKey_XXXX.p8`, `interval/prod/apns-key-id`, `interval/prod/apns-team-id`
   - AWS: the same under `interval/aws/…`
   - Local: `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID` in `.env`, plus `APNS_SANDBOX=1` for a development build (Xcode or `expo run:ios`); release builds use APNs production.
3. Get the environment right: a development build's token sent to APNs production (or the reverse) is refused as BadDeviceToken. The worker logs it and keeps the token; only a 410 drops one.
4. The app's bundle id (`dev.interval.app`) must have the Push Notifications capability; W22-S05 replaces it with the store id (and `APNS_TOPIC` in `adapters/http_native_push.py` with it).

## Google (Android)

1. In Firebase: create a project, add an Android app with package `dev.interval.app`, and download `google-services.json` for the app build (W22-S05).
2. Project settings → Service accounts → Generate new private key: a JSON file.
3. Store `base64 -i service-account.json` as `interval/prod/fcm-service-account` (VM), `interval/aws/fcm-service-account` (AWS), or `FCM_SERVICE_ACCOUNT` locally.

## Checking it

1. On a phone with the app: Profile → Notify me on this phone (allow).
2. `scripts/with-env.sh uv run python -m interval_jobs push-test --email <your account>` prints `{"sent": n, "failed": n, "gone": n}`; the phone shows "Test notification". A dead token is dropped.

## Opt-in pushes (P4-W24-S01b, Q-P4-13)

- **What:** users turn on the daily challenge, path reminders or "your break is ready" on Profile (web or app) and pick an hour, 08:00–20:00 in their own time zone.
- **When:** `push-due` runs hourly (EventBridge Scheduler `PushDueSchedule` on AWS; `interval-push.timer` on the VM). It sends each user at most one a day, at or after their hour and before 21:00 local, in the order daily challenge, path reminder, digest, to their browsers (web push, the VAPID keys) and phones (APNs and FCM, as above).
- **Once a day:** the day is claimed in `push_sent` before sending. A user with nowhere to send is left unclaimed, so a phone or browser added later that day still gets it.
- **By hand:** `scripts/with-env.sh uv run python -m interval_jobs push-due` prints `{"sent": n, "skipped": n, "failed": n}`. A dead browser or phone is dropped. A claimed push that reached nobody is logged as "push: not delivered" and counted by the `Interval/Push NotDelivered` metric; each failed browser is logged as "reminder: push failed".
