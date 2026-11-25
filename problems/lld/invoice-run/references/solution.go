package main

const maxCents = 10_000_000

// Tax rates in basis points (hundredths of a percent), so cents times a rate is in
// ten-thousandths of a cent.
var taxRates = map[string]int64{"us": 725, "eu": 2100, "jp": 1000}

const basis = 10_000

// What the run knows about one customer between invoices.
type account struct {
	usage, balance, rate, coupon int64
}

// The invoice on its way through the steps. `due` is what is still to be charged: each
// step reads it and takes its part off. Tax stays in ten-thousandths of a cent until
// rounding.
type draft struct {
	subtotal, due, credited, taxExact, tax int64
}

// Each step is one concern: it sees only what is due, never how earlier steps got there.
func subtotalStep(a *account) *draft { return &draft{subtotal: a.usage, due: a.usage} }

func discountStep(d *draft, a *account) { d.due -= d.due * a.coupon / 100 }

func creditStep(d *draft, a *account) {
	d.credited = d.due
	if a.balance < d.credited {
		d.credited = a.balance
	}
	d.due -= d.credited
}

func taxStep(d *draft, a *account) { d.taxExact = d.due * a.rate }

func roundingStep(d *draft) {
	cents, rest := d.taxExact/basis, d.taxExact%basis
	if 2*rest >= basis {
		cents++
	}
	d.tax = cents
}

func checkCents(cents int64) {
	if cents < 1 || cents > maxCents {
		panic("cents must be within 1 and 10^7")
	}
}

type InvoiceRun struct {
	accounts map[string]*account
}

func NewInvoiceRun() *InvoiceRun {
	return &InvoiceRun{accounts: map[string]*account{}}
}

func (r *InvoiceRun) account(customer string) *account {
	if customer == "" {
		panic("a customer has a name")
	}
	found, ok := r.accounts[customer]
	if !ok {
		found = &account{}
		r.accounts[customer] = found
	}
	return found
}

func (r *InvoiceRun) known(customer string) *account {
	found, ok := r.accounts[customer]
	if !ok {
		panic("unknown customer")
	}
	return found
}

func (r *InvoiceRun) usage(customer string, cents int64) {
	checkCents(cents)
	r.account(customer).usage += cents
}

func (r *InvoiceRun) credit(customer string, cents int64) {
	checkCents(cents)
	r.account(customer).balance += cents
}

func (r *InvoiceRun) region(customer string, region string) {
	rate, ok := taxRates[region]
	if !ok {
		panic("unknown region")
	}
	r.account(customer).rate = rate
}

func (r *InvoiceRun) invoice(customer string) []int64 {
	a := r.known(customer)
	d := subtotalStep(a)
	discountStep(d, a)
	creditStep(d, a)
	taxStep(d, a)
	roundingStep(d)
	a.usage = 0
	a.balance -= d.credited
	a.coupon = 0
	return []int64{d.subtotal, d.credited, d.tax, d.due + d.tax}
}

func (r *InvoiceRun) carryOver(customer string) int64 {
	return r.known(customer).balance
}

// The extension round: one more step, between the subtotal and the credits.
func (r *InvoiceRun) coupon(customer string, percent int64) {
	if percent < 1 || percent > 100 {
		panic("percent must be within 1 and 100")
	}
	r.account(customer).coupon = percent
}
