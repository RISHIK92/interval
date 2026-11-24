# 0053. HLD selectable providers: the player picks the external provider's provider and channel, at real list prices by region

- Status: ACCEPTED (owner, 2026-11-24)
- Date: 2026-11-24
- Supersedes: none
- Superseded by: none

## Context

ADR-0050 (ACCEPTED) added the external provider to spec 2.0, and ADR-0051 (ACCEPTED, §3) said "each family sets its price per call (Q-WD-31). The prices stay PROVISIONAL." The owner then decided (Q-WD-32, 2026-11-24):

- "Messaging and payment providers are selectable on the external provider":
  - Twilio, MSG91, Amazon (SNS/SES) and Vonage, over SMS, WhatsApp, email and voice, priced by the problem's region;
  - Stripe, Razorpay and PayPal for payments;
  - real list prices from docs/hld-provider-prices.md (PROVISIONAL, seen 2026-11-24).
- From the session's brief: a provider or channel not offered in the problem's region can't be picked, or is priced at its international rate where the doc says so; a payment's fee is its percentage plus its fixed fee, applied to the problem's average ticket.

The owner accepted this ADR on 2026-11-24 with four changes, folded in below:

1. Payment fees are paid apart from the infrastructure budget. The budget covers the system only. Processing fees show as "fees per payment", with their own target: the cheapest suitable processor for the region, with the same headroom rule as messaging fees (none). `paypal-fees` fails that target, not the budget. Messaging fees stay inside the budget, as a realistic operating cost.
2. Push providers for notification-service: FCM and APNs (free), Amazon SNS mobile push and OneSignal, on channel "push".
3. otp-login offers email too, a latency lesson only if the engine can show it honestly; Amazon's India SMS uses the local DLT route.
4. This ADR is accepted with these changes.

CANVAS-4 makes every number the simulator uses part of the public, versioned spec, so the price table and the rules for what isn't published need a decision. CANVAS-3 asks for deterministic, explained results; HLDQ-3 asks that each flaw fail exactly its target. Spec 2.0 takes effect on 2026-12-01 and 2.1 on 2027-01-01 (Q-WD-31), so no match, round or practice problem has been drawn on a 2.0 or 2.1 family yet: both can still be amended.

## Options

### A. A provider table on the sheet; messaging and push fees budgeted at the reference's pick; card fees against their own target (as built, accepted)

- Pros:
  - every price is on /hld/spec with its source, the day it was seen and PROVISIONAL;
  - a dearer messaging or push pick goes over budget: Twilio's SMS in India costs 46 times MSG91's, and OneSignal at 10 million users costs $120,000 a month where FCM is free. Infrastructure keeps the headroom it had;
  - card fees, hundreds of millions of dollars a month at payment-processing's volume, no longer swamp the budget, and a dearer processor still fails something: its fee target.
- Cons: any pick dearer than the reference's fails, even PayPal's 15% more per $40 payment.
- Cost to reverse: low before each version takes effect; after it, a balance patch.

### B. The same table, with the usual headroom on fees too

- Cons: PayPal's 15% more passes in both modes, so the pick teaches nothing.

### C. Keep a price per family (ADR-0051 §3)

- Cons: against the owner's decision (Q-WD-32).

## Decision

Option A, with the owner's changes of 2026-11-24.

### 1. The selection model

- **The problem.** A problem may offer a pick in place of a price per call: `traffic.provider = { region, channels, ticketUsd?, feeTargetUsd?, monthlyUsers? }`.
  - `region`: where its users are, `us` or `in`; it sets every price.
  - `channels`: the channels that reach them: `sms`, `whatsapp`, `email`, `voice`, `push`, or `card` alone.
  - `ticketUsd` and `feeTargetUsd`: the average payment and the most a payment's fee may be. Both are required with `card` and refused without it.
  - `monthlyUsers`: what a per-user price is charged on. Required with `push`, refused without it.
  - A problem names a price per call or an offer, never both. The rate limit (`providerRps`) stays the problem's either way.
  - It's valid only under a version whose features have the table (`providers`: 2.0 and 2.1).
- **The design.** An external provider's config gains `provider` and `channel`. Both start unset; the canvas sets them from the problem's offer.
- **What's usable.** A pick is usable when both are set, its channel is one of the problem's, and the sheet has a price for that provider, channel and region.
- **No usable pick, no work.** The provider counts as not reached for `requires` (ADR-0051), so the types it serves aren't served and nothing is billed.
  - The explanation says why: "sms has no provider and channel picked, so it does no work.", "sms: Vonage doesn't offer WhatsApp at a published price in India, so it does no work.".
  - A problem that sets its own price ignores a pick: its results are exactly as before.

### 2. Region pricing: the table

- **Where it lives.** Spec 2.0's feature `providers` holds the table, with the day it was seen; 2.1 inherits it. 1.0 has none.
- **What an entry holds.** One entry per provider × channel × region, US and India:
  - USD per unit; for a payment, its percentage and fixed fee;
  - a monthly fee, and a price per monthly active user, where there is one;
  - the unit;
  - the published rate limit and SLA, or none;
  - its source URL, and whether the figure is secondary;
  - a note.
- **Its numbers.** Taken from docs/hld-provider-prices.md's summary table at that doc's FX (1 USD = 92.92 INR = 0.91416 EUR). Voice is one billed minute a call. Push is priced alike in both regions.
- **Not offered, or not published there.** The entry is listed with no price and can't be picked:
  - MSG91's US email and voice;
  - Vonage's WhatsApp and email;
  - Razorpay in the US;
  - PayPal in India: only its international rate is published, and its fixed fee by currency couldn't be read, so no complete price exists.
- **Choices the doc leaves open:**
  - Amazon SMS in India uses the local DLT route, $0.004, as the owner confirmed (MSG91's domestic SMS needs DLT too). The default international route is $0.071.
  - MSG91's India voice price is its landline rate, $0.0054; no mobile rate is listed.
  - MSG91's WhatsApp is Meta's rate, assumed passed through unchanged, plus its monthly fee ($5.38 in India, $7 in the US).
  - Vonage's US SMS is $0.0112; its US carrier fees aren't published and aren't added.
  - Twilio's and Amazon's email are priced alike in both regions ("any" in the doc).
  - Razorpay's 2% carries 18% GST on the fee: 2.36%. Other Indian prices exclude GST, as the doc's are.
  - Amazon SNS push is $0.50 per million publishes plus $0.50 per million deliveries, $0.000001 a notification. It's a secondary figure: AWS's pricing tables didn't render to an automated read.
  - APNs's $99-a-year developer membership isn't counted.
  - Not counted: SNS's free million a month, Twilio's $0.001 for a failed SMS, US 10DLC registration fees, SES attachments.

The table as built (USD; "–" can't be picked):

| Provider  | Channel  | US                                  | India                               | Published SLA |
| --------- | -------- | ----------------------------------- | ----------------------------------- | ------------- |
| Twilio    | SMS      | 0.0126                              | 0.0832                              | 99.95%        |
| Twilio    | WhatsApp | 0.0076                              | 0.0062                              | 99.95%        |
| Twilio    | Email    | 0.0004 (sec.)                       | 0.0004 (sec.)                       | 99.95%        |
| Twilio    | Voice    | 0.014                               | 0.0496                              | 99.95%        |
| MSG91     | SMS      | 0.0078                              | 0.0018                              | none          |
| MSG91     | WhatsApp | 0.0026 + $7/month                   | 0.0012 + $5.38/month                | none          |
| MSG91     | Email    | –                                   | 0.00022                             | none          |
| MSG91     | Voice    | –                                   | 0.0054 (landline)                   | none          |
| Amazon    | SMS      | 0.01195                             | 0.004 (local DLT route)             | 99.9%         |
| Amazon    | WhatsApp | 0.0076                              | 0.0032                              | none          |
| Amazon    | Email    | 0.0001 (SES)                        | 0.0001 (SES)                        | 99.9%         |
| Amazon    | Voice    | 0.013                               | 0.038                               | 99.9%         |
| Amazon    | Push     | 0.000001 (SNS, sec.)                | 0.000001 (SNS, sec.)                | 99.9%         |
| Vonage    | SMS      | 0.0112 (+ carrier fees)             | 0.086                               | none          |
| Vonage    | WhatsApp | –                                   | –                                   | none          |
| Vonage    | Email    | –                                   | –                                   | none          |
| Vonage    | Voice    | 0.0144                              | 0.0748                              | none          |
| FCM       | Push     | 0                                   | 0                                   | none          |
| APNs      | Push     | 0 (Apple devices only)              | 0 (Apple devices only)              | none          |
| OneSignal | Push     | $19/month + $0.012 per monthly user | $19/month + $0.012 per monthly user | none          |
| Stripe    | Card     | 2.9% + $0.30 (sec.)                 | 2%                                  | none          |
| Razorpay  | Card     | –                                   | 2.36% (2% + GST on fee)             | none          |
| PayPal    | Card     | 2.99% + $0.49 (sec.)                | –                                   | none          |

Sources and the day each was seen, 2026-11-24, are on each entry and on /hld/spec. The push sources are firebase.google.com/pricing, developer.apple.com/programs, aws.amazon.com/sns/pricing with aws.amazon.com/messaging/sla, and onesignal.com/pricing.

Rate limits as published are kept on each entry, for example Twilio's short code at 100 a second, Amazon's voice at 20 calls a minute, FCM's 600,000 messages a minute per project, and Stripe's 100 requests a second.

### 3. What a provider doesn't publish

- **Latency.** No provider publishes one. Every call takes the sheet's 250 ms, shown as "a simulated estimate, not published by the provider".
- **Availability.** A published SLA is the provider's availability: Twilio 99.95%; Amazon 99.9% for SMS, voice, SES and SNS. Everything else uses the sheet's 99.50%, shown the same way.
- **Rate limit.** Always the problem's `providerRps`. The published figures are per sending number, per project, or default quotas a provider raises on request, so none is an account's real ceiling. They're shown on the sheet for reference.
- **Delivery time.** No provider publishes how long an SMS or an email takes to arrive. So email isn't made a latency lesson (owner's change 3): the engine could only show it with a delivery time it would have to invent. Email's slowness and spam folders stay the rubric's.

### 4. Payments, push and monthly fees

- **A payment's fee** is `percent × ticketUsd + fixed`.
- **Charged once, at capture.** A request type with `billed: false` reaches the provider without being charged: payment-processing's authorization.
- **Card fees are paid apart from the budget** (owner, 2026-11-24).
  - The month's card fees aren't part of `costPerMonth`.
  - The result carries `fees: { perPayment, target, perMonth }`. `perPayment` is the dearest usable processor's fee, or null with none.
  - Fees per payment over `feeTargetUsd` score like a cost over the budget, in every scenario.
  - The explanation reads: "Fees per payment: $1.69 at PayPal, over the target of $1.46. $177,232,320 a month, paid apart from the infrastructure budget."
- **A monthly fee**, and a price per monthly user times the problem's `monthlyUsers`, are billed once a month per external provider node that picks them.
- **A message or a notification** is billed per call that reaches the provider at baseline, as ADR-0051 §3 bills calls. It counts inside the budget.

### 5. Budgets and the fee target

- **Messaging and push.** A family that offers them budgets the reference pick's charges as they are, and its other costs with the usual headroom: budget = ⌈((cost − charges) × 1.5, or × 1.2 in the AI mode, + charges) ÷ 100⌉ × 100.
- **Card payments.** The budget is the infrastructure's alone, with the usual headroom.
  - The fee target is the cheapest processor's fee per payment in the region at the problem's ticket, rounded up to the cent, with no headroom.
  - It's stated as a requirement ("Processing fees of at most $1.46 a payment, paid apart from the budget.") with its own cover rule, `fees`.
- **Every other family's budget is unchanged.** With no charges, it's the same formula as before.
- **A new flaw target, `fees`.** Over the fee target, within budget, and meeting every target once the fee target is lifted.

### 6. Families

- **otp-login** (2.0, practice):
  - users in India, reached by SMS, WhatsApp, a voice call or email;
  - the reference picks MSG91's SMS;
  - email is cheaper (SES $0.0001) and passes; no email lesson (section 3);
  - flaw `twilio-sms`: the reference with Twilio's SMS fails only the budget (46 times the charges).
- **payment-processing** (2.0, battle):
  - users in the US paying $40 on average (PROVISIONAL), with a fee target of $1.46 a payment;
  - the reference picks Stripe ($1.46);
  - authorization is `billed: false`;
  - flaw `paypal-fees`: PayPal ($1.69, 15% more) fails only the fee target.
- **notification-service** (2.1, battle):
  - push in the US, to 10 million monthly active users (PROVISIONAL);
  - the reference picks FCM (free; reaches Apple devices through APNs);
  - new flaw `onesignal-per-user`: OneSignal's $19 a month plus $0.012 per monthly user, $120,019 a month, fails only the budget;
  - its own price of $0.000001 a delivery is gone.
- **Not changed:**
  - webhook-delivery: customers' own endpoints;
  - web-crawler: the open web.

Budgets of the reference designs, USD a month:

| Family, mode, seed           | At HEAD (per-family price) | Interim draft (fees in budget) | As built                              |
| ---------------------------- | -------------------------- | ------------------------------ | ------------------------------------- |
| otp-login human 1 (practice) | 225,400                    | 534,400                        | 534,400 (SMS $529,805)                |
| otp-login human 2            | 305,100                    | 724,500                        | 724,500                               |
| otp-login human 3            | 241,800                    | 572,900                        | 572,900                               |
| otp-login human 4            | 233,900                    | 554,000                        | 554,000                               |
| otp-login ai 2               | 374,200                    | 1,105,900                      | 1,105,900                             |
| otp-login ai 3               | 278,600                    | 821,000                        | 821,000                               |
| otp-login ai 4               | 374,200                    | 1,105,900                      | 1,105,900                             |
| payment-processing human 1   | 167,300                    | 399,038,900                    | 3,300 (+ fees $1.46 a payment, apart) |
| payment-processing human 2   | 142,000                    | 337,648,700                    | 3,300                                 |
| payment-processing human 3   | 205,600                    | 491,124,500                    | 3,800                                 |
| payment-processing ai 1      | 237,700                    | 705,991,500                    | 5,500                                 |
| payment-processing ai 2      | 217,200                    | 644,601,200                    | 5,300                                 |
| payment-processing ai 3      | 207,100                    | 613,906,100                    | 5,300                                 |
| notification-service human 1 | 9,800                      | (unchanged)                    | 6,400                                 |
| notification-service human 2 | 9,800                      | (unchanged)                    | 6,300                                 |
| notification-service human 3 | 13,500                     | (unchanged)                    | 8,700                                 |
| notification-service ai 1    | 18,800                     | (unchanged)                    | 12,200                                |
| notification-service ai 2    | 18,000                     | (unchanged)                    | 12,300                                |
| notification-service ai 3    | 18,000                     | (unchanged)                    | 12,200                                |

At HEAD, otp-login paid $0.0005 a send, payment-processing $0.0002 for each authorization and each capture, and notification-service $0.000001 a delivery, all inside the budget.

### 7. Versions, pool and calibration

- **2.0 amended before it takes effect.** 2.0 gains the table and a patch note ("Pick your provider", amended on 24 Nov 2026). 2.1 inherits both.
- **1.0 is byte-identical:** its pool, calibration designs and golden results.
- **The pool is unchanged for every family.** Every family's seeds stay valid, so `pool.ts` didn't move.
- **Calibration.** The 18 designs of otp-login, payment-processing and notification-service changed, and their suggestions were re-suggested by the same rules: the same levels, reasons reworded for the provider's name. Only the owner's grades count.

### 8. The player's view

- **The canvas.** The external provider's Selected panel shows Provider and Channel selects. Each option carries its price in the problem's region ("MSG91 · from $0.0012 per message + $5.38 a month", "SMS · $0.0018 per SMS", "Stripe · 2.9% + $0.30 per payment ($1.46 at $40)"). One not offered there is disabled.
- **Warnings.**
  - Nothing usable picked: "Nothing picked that it can use: pick a provider and channel offered in India. Until then it does no work."
  - Charges over the budget: "The providers' fees take the design over budget: $… a month, against a budget of $…. Send this one (Twilio SMS) only what it delivers, or pick a cheaper provider or channel."
  - Card fees over their target: "Its fees per payment are over their target: PayPal charges $1.69 a payment, against $1.46. A cheaper processor would meet it."
- **Coverage keeps fees and the budget apart.** The fee cover reads the design as if its budget were unlimited, and every other cover as if its fee target were, so neither uncovers the other.
- **Hints and coverage** name the pick: "The external provider (Twilio SMS) hits its rate limit…", "External provider, MSG91 SMS; done within a second", "Fees per payment at PayPal are over their target…". A budget blown mostly by charges says so.
- **The judge** reads the pick as config fields (`"provider": "msg91", "channel": "sms"`), ids from fixed lists, never free text. Where the problem has card fees, it also reads `feePerPayment` and `feeTargetPerPayment` ("Fees per payment: $1.46 against a target of $1.46, paid apart from the budget."). Its one line on the external provider says what the pick fields mean.
- **/hld/spec** lists every entry with its price, rate limit, SLA (or the labelled estimate), its source link, "Seen 24 Nov 2026 · Provisional", and "Secondary source" where the doc marks one.

## Consequences

- `packages/hld`:
  - `catalog.ts`: provider and channel ids and names, including push, and the external provider's two optional fields;
  - `spec.ts`: the table, `providers` and `REGION_NAMES`, and 2.0's patch note;
  - `problem.ts`: `traffic.provider` (with the fee target and monthly users), `billed`, the `fees` cover;
  - `providers.ts` (new): prices, picks, the cheapest fee, the canvas's offer and `pickProvider`;
  - `simulate.ts`: pricing, SLA and no-work rules, card fees apart with their score, `NodeResult.provider`, `providerCostPerMonth` and `fees`;
  - `family.ts`: the offer, the fee target, the requirement's words, the budget rule and the `fees` flaw target;
  - `families.ts`: the three families;
  - `edit.ts`, `hints.ts`, `coverage.ts`, `judge.ts`;
  - regenerated `calibration.json`; re-suggested `calibration-suggestions.json`.
- Web:
  - the canvas's Provider and Channel selects and warnings;
  - the node's face names its pick;
  - /hld/spec's "Providers you can pick".
- Worker: the judge's external provider line, and fees per payment.
- docs/hld-provider-prices.md: push providers (section 3a and the summary table).
- No migration: designs and problems are JSON, and the new fields are optional.

## Open questions

1. Prices change: who re-reads docs/hld-provider-prices.md before launch, and does a change ship as a balance patch at a season boundary (CANVAS-4)?
2. The $40 ticket and notification-service's 10 million monthly users are PROVISIONAL family numbers; draw them per variant later?
3. Rate limits as published (per number, per project) aren't simulated; each problem's stands. Revisit if a family's lesson needs a provider's own ceiling (FCM's 600,000 a minute, for example).
