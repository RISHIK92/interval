# Invoice run: coupons (extension round)

> PROVISIONAL (LLD practice batch C2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Marketing hands out percentage coupons, which need a new step between the subtotal and the
credits.

- `coupon(customer, percent)`: the customer's next invoice takes `percent` off its
  subtotal: a discount of `subtotal × percent ÷ 100`, rounded down. A coupon is for one
  invoice only: the next `invoice` uses it up, even one with no usage. A second coupon
  before that replaces the first. `percent` outside 1 to 100, or an empty name, fails. Like
  `usage`, a coupon makes the customer exist.
- Credits then come off what's left after the discount (never more than that), and tax
  applies to what's left after both.
- `invoice` still returns `[subtotal, credits, tax, total]`, with `subtotal` before the
  discount, so `total = subtotal − discount − credits + tax`.

For example, a `"us"` customer with 10000 cents of usage, 2000 of credit and a 10% coupon
is invoiced `[10000, 2000, 508, 7508]`: the tax on 7000 is 507.5, rounded up.
