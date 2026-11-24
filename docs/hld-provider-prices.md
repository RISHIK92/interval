# HLD external provider prices

**PROVISIONAL: list prices as seen on 2026-11-24; they change; review before launch.**

Reference data for the HLD simulator's "external provider" node: what one outbound message, call or payment costs at each provider, and the operational limits the provider publishes. Every number below was read on 2026-11-24 from the URL next to it. Where a provider does not publish a figure, the cell says "not published"; where a page could not be read by an automated fetch, the cell says so and nothing was filled in from memory.

## Conventions

- **FX** (ECB euro reference rates via api.frankfurter.dev, rate date 2026-11-23, seen 2026-11-24): 1 USD = 92.92 INR = 0.91416 EUR = 0.76491 GBP. So 1 EUR = 1.0939 USD.
- **Use case**: one transactional or OTP message to one recipient. SMS prices are per segment (160 GSM-7 characters); an OTP fits in one segment.
- **Voice OTP call**: assumed 30 to 60 s, priced as **one billed minute**. The per-call figure equals the per-minute price. (Rounding rules per provider were not verified; a 61 s call would cost two minutes at providers that round up.)
- **Taxes**: Indian prices exclude 18% GST unless stated. US prices exclude sales tax.
- **"Secondary"** marks a figure taken from a search-result snippet of the provider's own page (the page itself refused automated fetch). Confirm before launch.

## 1. Messaging prices

### WhatsApp pricing model (applies to every provider)

Meta charges **per delivered template message** (since 2025-07-01; conversation pricing is deprecated), by market and category. Service replies inside the 24 h window are free up to 1,000 per number per month; from 2026-10-01 utility templates sent inside the window are billable. Utility and authentication have monthly volume tiers that lower the rate. Meta may change rates only on Jan 1, Apr 1, Jul 1 or Oct 1. India-billed businesses must move to INR billing by 2026-12-31.
Source: <https://developers.facebook.com/docs/whatsapp/pricing> (seen 2026-11-24).

Meta list rates per message, USD, rate card effective 2026-10 (Meta's card as republished by AWS on its pricing page: <https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/business-applications/approved/documents/2026-10-usd-rates.12c5e2244978e162c3431f0dee6a2c09acfa91b9.csv>, linked from <https://aws.amazon.com/end-user-messaging/pricing/>, seen 2026-11-24):

| Market        | Authentication | Utility   | Authentication-international | Marketing |
| ------------- | -------------- | --------- | ---------------------------- | --------- |
| North America | $0.002563      | $0.002563 | n/a                          | $0.018841 |
| India         | $0.001183      | $0.001183 | $0.025691                    | $0.008880 |
| UK            | $0.016587      | $0.016587 | n/a                          | $0.047837 |

India in INR: authentication/utility $0.001183 = ₹0.110 at the FX above. Third-party Indian sources quote Meta's INR card at ₹0.115 (not verified on a Meta page). Authentication-international applies to businesses outside India sending OTPs to Indian numbers. Twilio's WhatsApp page says Meta fees "start at $0.0034/message", which is higher than the 2026-10 North America figure above (Meta lowered North America on 2026-01-01); the AWS-hosted card is the newer one.

Every provider adds its own fee to Meta's: Twilio $0.005/message, AWS $0.005/message ($0.002 for India authentication and utility), MSG91 a monthly subscription (per-message amounts behind a "View rates" link that did not load), Vonage not readable.

### Twilio (SendGrid for email)

| Channel      | Region | Local price                           | USD                                    | Unit                | Source                                                                          |
| ------------ | ------ | ------------------------------------- | -------------------------------------- | ------------------- | ------------------------------------------------------------------------------- |
| SMS          | US     | $0.0083 + carrier fee $0.0035–$0.0050 | **$0.0126** (base + mean AT&T/TMO/VZW) | segment             | <https://www.twilio.com/en-us/sms/pricing/us>                                   |
| SMS          | India  | ₹7.73                                 | **$0.0832**                            | segment             | <https://www.twilio.com/en-us/sms/pricing/in>                                   |
| SMS          | UK     | £0.0428                               | **$0.056**                             | segment             | <https://www.twilio.com/en-us/sms/pricing/gb>                                   |
| WhatsApp     | US     | $0.005 + Meta $0.002563               | **$0.0076**                            | message (per-msg)   | <https://www.twilio.com/en-us/whatsapp/pricing> + Meta card above               |
| WhatsApp     | India  | ₹0.57                                 | **$0.0062** ($0.005 + $0.001183)       | message (per-msg)   | same                                                                            |
| WhatsApp     | UK     | £0.0165                               | **$0.0216** ($0.005 + $0.016587)       | message (per-msg)   | same                                                                            |
| Email        | any    | $19.95/month Essentials (50K emails)  | **$0.0004** (plan average)             | email               | <https://www.twilio.com/en-us/products/email-api/pricing> (50K base: secondary) |
| Voice (call) | US     | $0.0140/min                           | **$0.0140**                            | minute (= one call) | <https://www.twilio.com/en-us/voice/pricing/us>                                 |
| Voice (call) | India  | ₹4.61/min (mobile)                    | **$0.0496** (landline $0.0699)         | minute (= one call) | <https://www.twilio.com/en-us/voice/pricing/in>                                 |
| Voice (call) | UK     | £0.0233/min (mobile)                  | **$0.0305** (landline $0.0158)         | minute (= one call) | <https://www.twilio.com/en-us/voice/pricing/gb>                                 |

Notes: a $0.001 fee applies to each SMS that ends "Failed". US 10DLC needs paid registration. India has no separate domestic rate on the page (discounts "by contacting sales"). SendGrid overage beyond the plan volume is $0.0013/email on Essentials 50K (secondary).

### MSG91

| Channel      | Region | Local price                                                       | USD                                  | Unit                | Source                                   |
| ------------ | ------ | ----------------------------------------------------------------- | ------------------------------------ | ------------------- | ---------------------------------------- |
| SMS          | India  | ₹0.25 (5K slab) → ₹0.17 (60K slab) → ₹0.16 (962.5K slab), ex. GST | **$0.0018** (₹0.17)                  | SMS                 | <https://msg91.com/in/pricing/sms>       |
| SMS          | US     | $0.0078                                                           | **$0.0078**                          | SMS                 | <https://msg91.com/us/pricing/sms>       |
| SMS          | UK     | not listed                                                        | not listed                           |                     |                                          |
| WhatsApp     | India  | ₹500/month per number + Meta rate card                            | **$0.0012** (Meta ₹0.110) + $5.38/mo | message + monthly   | <https://msg91.com/in/pricing/whatsapp>  |
| WhatsApp     | US     | $7/month + Meta rate card                                         | **$0.0026** (Meta) + $7/mo           | message + monthly   | <https://msg91.com/us/pricing/whatsapp>  |
| Email        | India  | ₹2,000/month for 100K (Starter); extra ₹0.02                      | **$0.00022**                         | email               | <https://msg91.com/in/pricing/email>     |
| Email (OTP)  | India  | ₹0.03                                                             | $0.00032                             | email OTP           | <https://msg91.com/in/pricing/otpwidget> |
| Voice (call) | India  | ₹0.50/min (landline); mobile not listed                           | **$0.0054**                          | minute (= one call) | <https://msg91.com/in/pricing/voice>     |
| Voice (call) | US, UK | not listed                                                        | not listed                           |                     |                                          |

Notes: the WhatsApp pages say per-message charges are "billed per rate card" and do not state a markup; the USD column assumes Meta's rate passes through unchanged, which MSG91's page does not confirm. The ₹500 / $7 monthly fee is waived for the first two months.

### Amazon (AWS End User Messaging SMS/Voice/Social, SES)

| Channel      | Region | Local price                                            | USD                            | Unit                | Source                                                                                                                                                                                                                |
| ------------ | ------ | ------------------------------------------------------ | ------------------------------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SMS          | US     | $0.00774 + carrier fee $0.00421 (10DLC/toll-free/long) | **$0.01195**                   | message part        | <https://d1.awsstatic.com/onedam/marketing-channels/website/aws/en_US/business-applications/approved/documents/End-User-Messaging-SMS-Prices.ebc340b4d416d90832dd59629c4792b0deb6f8bc.csv> (linked from pricing page) |
| SMS          | India  | ₹0.37 local route / ₹6.60 international route          | **$0.004** local / $0.071 intl | message part        | same CSV ("India local" needs India DLT compliance; default route is international)                                                                                                                                   |
| SMS          | UK     | £0.0382                                                | **$0.05**                      | message part        | same CSV                                                                                                                                                                                                              |
| WhatsApp     | US     | $0.005 AWS + $0.002563 Meta                            | **$0.0076**                    | message (per-msg)   | <https://aws.amazon.com/end-user-messaging/pricing/> + Meta card above                                                                                                                                                |
| WhatsApp     | India  | ₹0.30 ($0.002 AWS + $0.001183 Meta)                    | **$0.0032**                    | message (per-msg)   | same                                                                                                                                                                                                                  |
| WhatsApp     | UK     | £0.0165                                                | **$0.0216**                    | message (per-msg)   | same                                                                                                                                                                                                                  |
| Email (SES)  | any    | $0.10 per 1,000 (pay-as-you-go)                        | **$0.0001**                    | email               | <https://aws.amazon.com/ses/pricing/>                                                                                                                                                                                 |
| Voice (call) | US     | $0.013/min                                             | **$0.013**                     | minute (= one call) | <https://aws.amazon.com/end-user-messaging/pricing/>                                                                                                                                                                  |
| Voice (call) | India  | ₹3.53/min                                              | **$0.038**                     | minute (= one call) | same                                                                                                                                                                                                                  |
| Voice (call) | UK     | not checked                                            | not checked                    |                     |                                                                                                                                                                                                                       |

Notes: SES also lists plan tiers (Essentials $0.16, Pro $0.22 + $105/month, Enterprise $0.23 + $500/month per 1,000 for the first 10M) and $0.12/GB of attachments. US 10DLC adds $4 one-time brand, $10/month per campaign, $1/month per number; toll-free numbers $2/month (<https://aws.amazon.com/sns/sms-pricing/>).

### Vonage

Prices from Vonage's official downloadable price sheet (default list prices in EUR, linked from the SMS pricing page): <https://dashboard.nexmo.com/download_pricing>, seen 2026-11-24. The HTML pricing pages load prices dynamically or returned 403.

| Channel      | Region | Local price                                                                                    | USD                                | Unit                | Valid from (sheet) |
| ------------ | ------ | ---------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------- | ------------------ |
| SMS          | US     | €0.0102                                                                                        | **$0.0112** (+ US carrier fees)    | message             | 2025-02-03         |
| SMS          | India  | €0.0786 (₹7.99)                                                                                | **$0.0860**                        | message             | 2026-03-23         |
| SMS          | UK     | €0.04839 (£0.0405)                                                                             | **$0.0529**                        | message             | 2025-02-03         |
| WhatsApp     | any    | page returned 403                                                                              | not retrievable                    |                     |                    |
| Email        | any    | no email API found on Vonage's API pricing pages                                               | not offered (not verified further) |                     |                    |
| Voice (call) | US     | €0.01314/min                                                                                   | **$0.0144**                        | minute (= one call) | 2025-02-07         |
| Voice (call) | India  | €0.06839/min (₹6.95)                                                                           | **$0.0748**                        | minute (= one call) | 2025-02-07         |
| Voice (call) | UK     | sheet's country-level row (€0.42 fixed, €2.44 mobile) looks like a worst-case prefix; not used | not used                           |                     | 2025-02-07         |

Notes: the US SMS page shows an "Additional Carrier Fees" panel for US traffic whose amounts did not load. Third-party guides also mention a Vonage per-message platform fee "from $0.00015"; not verified on a Vonage page.

## 2. Operational characteristics

Only what the provider publishes. Delivery latency: **not published** by any of the four (no figure found on pricing, docs or SLA pages).

### Twilio

- **Short code**: 100 MPS per number (<https://www.twilio.com/docs/messaging/guides/market-throughput-overview>).
- **Toll-free (US)**: 3 MPS default (secondary: Twilio guide snippet; AWS documents the same 3 MPS carrier limit).
- **US 10DLC long code**: set by the A2P 10DLC campaign's carrier tier; no single default published. The older "1 MPS per long code" figure appears only in an old Twilio blog post.
- **India / international long code**: not published.
- **Queue**: messages above the rate are queued, up to **10 hours** (<https://www.twilio.com/docs/messaging/guides/account-based-throughput-overview>).
- **Voice**: 1 outbound call per second (CPS) per account by default; up to 5 CPS self-serve with an approved Business Profile; calls queued beyond that, cancelled after 24 h (<https://www.twilio.com/docs/voice/api/call-resource>, secondary).
- **SLA**: **99.95%** monthly API availability (99.99% on Enterprise Edition and some SendGrid packages); 10% credit below threshold; outages under 5 minutes excluded (<https://www.twilio.com/en-us/legal/service-level-agreement/twilio-apis>).

### MSG91

- Throughput, rate limits, SLA: **not published** (not found on the pricing pages read).

### Amazon

- **SMS MPS** (<https://docs.aws.amazon.com/sms-voice/latest/userguide/sms-limitations-mps.html>): US short code 100; US toll-free 3; US 10DLC per approved campaign (shared across the campaign's numbers); long codes outside US/CA 10; sender ID 10; shared routes 20. Any one recipient: 1 message per second.
- **SMS spend**: default **$1.00 per month** per account (raise via support) (<https://docs.aws.amazon.com/sms-voice/latest/userguide/quotas.html>).
- **API rate**: `SendTextMessage` and `SendVoiceMessage` 1 request/second default (adjustable), same page.
- **Voice**: 20 calls/minute out of sandbox (5 in sandbox); 1 call per second per origination number; 5 calls per recipient per 24 h; same page.
- **SES**: sandbox 1 email/second and 200 per 24 h; production quotas are set per account on request, no default published (<https://docs.aws.amazon.com/ses/latest/dg/manage-sending-quotas.html>).
- **SLA**: **99.9%** monthly uptime per region for SES and End User Messaging (AWS User Engagement SLA, <https://aws.amazon.com/pinpoint/sla>). WhatsApp (End User Messaging Social) is not listed in that SLA: not published.

### Vonage

- Throughput / rate limits: not published (pages not readable).
- **SLA**: 99.99% platform availability on the enterprise support tier (secondary: <https://www.vonage.com/communications-apis/enterprise/support/>); standard tier not published.

## 3. Payment processors

| Provider | Region | Domestic card fee                                                       | International card                                                  | Other                                                                                            | Source                                                                                                    |
| -------- | ------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| Stripe   | US     | 2.9% + 30¢ (secondary)                                                  | +1.5%; +1% if currency conversion                                   | +0.5% manually entered cards                                                                     | <https://stripe.com/us/pricing> (fetch was geo-redirected to the India page; figures from search snippet) |
| Stripe   | India  | 2%, no fixed fee; domestic debit 0.4% MDR capped ₹200 (as stated)       | 3% Visa/MC, 3.5% Amex, 4.3% with USD presentment; +2% if conversion | none listed                                                                                      | <https://stripe.com/in/pricing>                                                                           |
| Razorpay | India  | 2% (cards, UPI, netbanking); 2.15% corporate cards; + 18% GST on fee    | up to 3%                                                            | UPI shown as zero MDR with 2% platform fee; international bank transfers 1%                      | <https://razorpay.com/pricing/>                                                                           |
| PayPal   | US     | 2.99% + $0.49 standard card; 3.49% + $0.49 other commercial (secondary) | +1.50%                                                              | fee page last updated 2026-02-09 per snippet; a PDF dated 2026-11-04 exists but was not readable | <https://www.paypal.com/us/webapps/mpp/merchant-fees> (403 to automated fetch)                            |
| PayPal   | India  | not verified                                                            | 4.40% + fixed fee by currency (secondary)                           |                                                                                                  | <https://www.paypal.com/in/webapps/mpp/merchant-fees> (403)                                               |

Rate limits and SLAs:

- **Stripe**: global **100 requests/second** live (25 in sandbox); **25 requests/second per endpoint** unless noted; **50 concurrent** live requests; read requests capped at an average of 500 per transaction over 30 days (<https://docs.stripe.com/rate-limits>). SLA: not published (Stripe cites 99.999% historical availability in press posts, not a contract).
- **Razorpay**: a rate limiter exists (HTTP 429) but **no numbers published** (<https://razorpay.com/docs/api/understand>). SLA: not published as a contract; the product page markets "99.9% uptime".
- **PayPal**: rate limits and SLA not published (not found).

## 4. Summary table for the engine

USD per unit at the FX above; voice per call = one billed minute. "sec." = secondary figure, confirm before launch. All seen 2026-11-24.

| Provider | Channel       | Region | USD / unit                             | Unit         | Rate limit (published)                                                   | SLA           | Source                                             |
| -------- | ------------- | ------ | -------------------------------------- | ------------ | ------------------------------------------------------------------------ | ------------- | -------------------------------------------------- |
| Twilio   | SMS           | US     | 0.0126                                 | segment      | short code 100 MPS; toll-free 3 MPS (sec.)                               | 99.95%        | twilio.com/en-us/sms/pricing/us                    |
| Twilio   | SMS           | India  | 0.0832                                 | segment      | not published                                                            | 99.95%        | twilio.com/en-us/sms/pricing/in                    |
| Twilio   | SMS           | UK     | 0.056                                  | segment      | short code 100 MPS                                                       | 99.95%        | twilio.com/en-us/sms/pricing/gb                    |
| Twilio   | WhatsApp      | US     | 0.0076                                 | message      | not published                                                            | 99.95%        | twilio.com/en-us/whatsapp/pricing + Meta card      |
| Twilio   | WhatsApp      | India  | 0.0062                                 | message      | not published                                                            | 99.95%        | twilio.com/en-us/whatsapp/pricing + Meta card      |
| Twilio   | Email         | any    | 0.0004                                 | email        | not published                                                            | 99.95%        | twilio.com/en-us/products/email-api/pricing        |
| Twilio   | Voice         | US     | 0.0140                                 | call (1 min) | 1 CPS default                                                            | 99.95%        | twilio.com/en-us/voice/pricing/us                  |
| Twilio   | Voice         | India  | 0.0496                                 | call (1 min) | 1 CPS default                                                            | 99.95%        | twilio.com/en-us/voice/pricing/in                  |
| MSG91    | SMS           | India  | 0.0018                                 | SMS          | not published                                                            | not published | msg91.com/in/pricing/sms                           |
| MSG91    | SMS           | US     | 0.0078                                 | SMS          | not published                                                            | not published | msg91.com/us/pricing/sms                           |
| MSG91    | WhatsApp      | India  | 0.0012 + $5.38/mo                      | message      | not published                                                            | not published | msg91.com/in/pricing/whatsapp + Meta card          |
| MSG91    | WhatsApp      | US     | 0.0026 + $7/mo                         | message      | not published                                                            | not published | msg91.com/us/pricing/whatsapp + Meta card          |
| MSG91    | Email         | India  | 0.00022                                | email        | not published                                                            | not published | msg91.com/in/pricing/email                         |
| MSG91    | Voice         | India  | 0.0054 (landline)                      | call (1 min) | not published                                                            | not published | msg91.com/in/pricing/voice                         |
| MSG91    | Voice         | US     | not listed                             |              |                                                                          |               |                                                    |
| Amazon   | SMS           | US     | 0.01195                                | message part | short code 100, toll-free 3, 10DLC per campaign MPS; $1/mo default spend | 99.9%         | AWS EUM SMS price CSV                              |
| Amazon   | SMS           | India  | 0.004 (local) / 0.071 (intl)           | message part | sender ID 10 MPS                                                         | 99.9%         | AWS EUM SMS price CSV                              |
| Amazon   | SMS           | UK     | 0.05                                   | message part | long code 10 MPS; sender ID 10 MPS                                       | 99.9%         | AWS EUM SMS price CSV                              |
| Amazon   | WhatsApp      | US     | 0.0076                                 | message      | not published                                                            | not published | aws.amazon.com/end-user-messaging/pricing          |
| Amazon   | WhatsApp      | India  | 0.0032                                 | message      | not published                                                            | not published | aws.amazon.com/end-user-messaging/pricing          |
| Amazon   | Email (SES)   | any    | 0.0001                                 | email        | sandbox 1/s, 200/day; production per account                             | 99.9%         | aws.amazon.com/ses/pricing                         |
| Amazon   | Voice         | US     | 0.013                                  | call (1 min) | 20 calls/min; 1/s per number                                             | 99.9%         | aws.amazon.com/end-user-messaging/pricing          |
| Amazon   | Voice         | India  | 0.038                                  | call (1 min) | 20 calls/min; 1/s per number                                             | 99.9%         | aws.amazon.com/end-user-messaging/pricing          |
| Vonage   | SMS           | US     | 0.0112 (+ carrier fees)                | message      | not published                                                            | not published | dashboard.nexmo.com/download_pricing               |
| Vonage   | SMS           | India  | 0.0860                                 | message      | not published                                                            | not published | dashboard.nexmo.com/download_pricing               |
| Vonage   | SMS           | UK     | 0.0529                                 | message      | not published                                                            | not published | dashboard.nexmo.com/download_pricing               |
| Vonage   | WhatsApp      | any    | not retrievable                        |              |                                                                          |               |                                                    |
| Vonage   | Email         | any    | not offered (not verified)             |              |                                                                          |               |                                                    |
| Vonage   | Voice         | US     | 0.0144                                 | call (1 min) | not published                                                            | not published | dashboard.nexmo.com/download_pricing               |
| Vonage   | Voice         | India  | 0.0748                                 | call (1 min) | not published                                                            | not published | dashboard.nexmo.com/download_pricing               |
| Stripe   | Card payment  | US     | 2.9% + 0.30 (sec.); intl +1.5%, FX +1% | transaction  | 100 req/s global, 25 req/s per endpoint, 50 concurrent                   | not published | stripe.com/us/pricing; docs.stripe.com/rate-limits |
| Stripe   | Card payment  | India  | 2%; intl 3% (+2% FX)                   | transaction  | 100 req/s global, 25 req/s per endpoint                                  | not published | stripe.com/in/pricing                              |
| Razorpay | Card/UPI      | India  | 2% (+18% GST on fee); intl up to 3%    | transaction  | not published (429 limiter exists)                                       | not published | razorpay.com/pricing                               |
| PayPal   | Card payment  | US     | 2.99% + 0.49 (sec.); intl +1.5%        | transaction  | not published                                                            | not published | paypal.com/us/webapps/mpp/merchant-fees            |
| PayPal   | International | India  | 4.40% + fixed (sec.)                   | transaction  | not published                                                            | not published | paypal.com/in/webapps/mpp/merchant-fees            |

## Gaps

- Vonage WhatsApp pricing, US carrier-fee amounts and UK voice: pages returned 403 or load prices dynamically.
- MSG91 per-message WhatsApp amounts and markup, India mobile voice rate, US email/voice: behind "View rates" links or not listed.
- Stripe US and PayPal (US, India) figures are from search snippets of the official pages, not a direct read; PayPal's 2026-11-04 fee PDF could not be parsed.
- Delivery latency: not published by any provider. Twilio and AWS India/international long-code throughput: not published.
- No contractual SLA found for Stripe, Razorpay, PayPal, MSG91, or AWS End User Messaging Social (WhatsApp).
