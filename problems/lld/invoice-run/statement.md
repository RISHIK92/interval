# Invoice run

> PROVISIONAL (LLD practice batch C2, Q-WD-30): drafted by Claude; the owner reviews it before launch.

Build a billing run that invoices customers for their usage. An invoice is made in steps,
each its own concern:

1. **Subtotal:** the usage recorded for the customer since their last invoice.
2. **Credits:** the customer's credit balance comes off the subtotal, but never more than
   the subtotal. Credit that isn't used stays in the balance for the next run.
3. **Tax:** the customer's regional rate applies to what's left after credits. A customer
   with no region set pays no tax.
4. **Rounding:** the tax is rounded to the nearest cent; exactly half a cent rounds up.

| Region | Tax rate |
| ------ | -------- |
| `"us"` | 7.25%    |
| `"eu"` | 21%      |
| `"jp"` | 10%      |

- `InvoiceRun()`: starts with no customers.
- `usage(customer, cents)`: adds usage to the customer's next invoice.
- `credit(customer, cents)`: adds to the customer's credit balance.
- `region(customer, region)`: sets the customer's region, replacing any earlier one; it
  applies from the next invoice. An unknown region (case matters) fails.
- `invoice(customer)`: runs the steps and returns `[subtotal, credits, tax, total]`, where
  `credits` is the credit used and `total = subtotal − credits + tax`. The customer's usage
  goes back to 0 and the credit used leaves the balance. A customer with no usage gets
  `[0, 0, 0, 0]` and keeps their balance.
- `carryOver(customer)`: the customer's credit balance: what the next invoice can use.

A customer exists once `usage`, `credit` or `region` has named them; `invoice` and
`carryOver` of anyone else fail. An empty customer name fails in every call, and so does
`cents` outside 1 to 10^7. A call that fails changes nothing. Names are printable ASCII and
case-sensitive. There are at most 10^4 calls.

For example, a `"us"` customer with 12000 cents of usage and 2000 of credit is invoiced
`[12000, 2000, 725, 10725]`: the tax on 10000 is 725.
