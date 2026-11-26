package main

const maxCents = 1_000_000_000

func checkCents(cents int64) {
	if cents < 1 || cents > maxCents {
		panic("cents run from 1 to 10^9")
	}
}

// One status and the operations it permits. Each state embeds refuseAll, so a state only
// names what it allows and everything else is refused.
type state interface {
	name() string
	confirm(p *PaymentIntent) bool
	settle(p *PaymentIntent, succeeded bool) bool
	capture(p *PaymentIntent, cents int64) bool
	refund(p *PaymentIntent, cents int64) bool
	dispute(p *PaymentIntent, cents int64) bool
}

type refuseAll struct{}

func (refuseAll) confirm(*PaymentIntent) bool        { return false }
func (refuseAll) settle(*PaymentIntent, bool) bool   { return false }
func (refuseAll) capture(*PaymentIntent, int64) bool { return false }
func (refuseAll) refund(*PaymentIntent, int64) bool  { return false }
func (refuseAll) dispute(*PaymentIntent, int64) bool { return false }

type awaitingPayment struct{ refuseAll }

func (awaitingPayment) name() string { return "awaiting_payment" }
func (awaitingPayment) confirm(p *PaymentIntent) bool {
	p.state = processing{}
	return true
}

type processing struct{ refuseAll }

func (processing) name() string { return "processing" }

// A repeated confirm is a retry of the one that got here: accepted, no change.
func (processing) confirm(*PaymentIntent) bool { return true }
func (processing) settle(p *PaymentIntent, succeeded bool) bool {
	if succeeded {
		p.state = succeededState{}
	} else {
		p.state = failed{}
	}
	return true
}

type failed struct{ refuseAll }

func (failed) name() string                                 { return "failed" }
func (failed) settle(_ *PaymentIntent, succeeded bool) bool { return !succeeded }

type succeededState struct{ refuseAll }

func (succeededState) name() string                                 { return "succeeded" }
func (succeededState) settle(_ *PaymentIntent, succeeded bool) bool { return succeeded }
func (succeededState) capture(p *PaymentIntent, cents int64) bool {
	if cents > p.amount-p.captured {
		return false
	}
	p.captured += cents
	return true
}
func (succeededState) refund(p *PaymentIntent, cents int64) bool {
	if !p.takeBack(cents) {
		return false
	}
	p.state = refunded{}
	return true
}
func (succeededState) dispute(p *PaymentIntent, cents int64) bool { return p.disputeHeld(cents) }

type refunded struct{ refuseAll }

func (refunded) name() string                               { return "refunded" }
func (refunded) refund(p *PaymentIntent, cents int64) bool  { return p.takeBack(cents) }
func (refunded) dispute(p *PaymentIntent, cents int64) bool { return p.disputeHeld(cents) }

type disputed struct{ refuseAll }

func (disputed) name() string { return "disputed" }

// The context: it holds the money and hands each operation to its current state.
type PaymentIntent struct {
	amount, captured, refunded int64
	state                      state
}

func NewPaymentIntent(amountCents int64) *PaymentIntent {
	checkCents(amountCents)
	return &PaymentIntent{amount: amountCents, state: awaitingPayment{}}
}

func (p *PaymentIntent) confirm() bool              { return p.state.confirm(p) }
func (p *PaymentIntent) settle(succeeded bool) bool { return p.state.settle(p, succeeded) }

func (p *PaymentIntent) capture(cents int64) bool {
	checkCents(cents)
	return p.state.capture(p, cents)
}

func (p *PaymentIntent) refund(cents int64) bool {
	checkCents(cents)
	return p.state.refund(p, cents)
}

func (p *PaymentIntent) status() string { return p.state.name() }

func (p *PaymentIntent) takeBack(cents int64) bool {
	if cents > p.captured-p.refunded {
		return false
	}
	p.refunded += cents
	return true
}

// The extension round: a chargeback freezes the payment.
func (p *PaymentIntent) dispute(cents int64) bool {
	checkCents(cents)
	return p.state.dispute(p, cents)
}

func (p *PaymentIntent) disputeHeld(cents int64) bool {
	if cents > p.captured-p.refunded {
		return false
	}
	p.state = disputed{}
	return true
}
