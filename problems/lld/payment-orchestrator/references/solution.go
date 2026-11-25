package main

const (
	maxCents       = 10_000_000
	maxFeeBps      = 1_000
	maxFailures    = 1_000
	cardFixedCents = 30
	bankCapCents   = 500
	chargeFailed   = "failed"
)

// Each kind's fee is its own rule behind one contract: given an amount and a rate in basis
// points, a fee in whole cents. A new kind is a new rule; nothing that charges changes.
type feeRule interface {
	fee(cents, bps int64) int64
}

type cardFee struct{}

func (cardFee) fee(cents, bps int64) int64 { return cents*bps/10_000 + cardFixedCents }

type walletFee struct{}

func (walletFee) fee(cents, bps int64) int64 { return cents * bps / 10_000 }

type bankFee struct{}

func (bankFee) fee(cents, bps int64) int64 { return min(cents*bps/10_000, bankCapCents) }

var feeRules = map[string]feeRule{"card": cardFee{}, "wallet": walletFee{}, "bank": bankFee{}}

// A provider as the orchestrator sees it: something that may fail an attempt, and a fee.
type paymentProvider struct {
	name     string
	rule     feeRule
	bps      int64
	failures int64
}

func (p *paymentProvider) attempt() bool {
	if p.failures == 0 {
		return true
	}
	p.failures--
	return false
}

func (p *paymentProvider) fee(cents int64) int64 { return p.rule.fee(cents, p.bps) }

type paymentCapture struct {
	provider string
	left     int64
}

// Settlement: what each provider owes the merchant, and what each charge can still refund.
type paymentLedger struct {
	settled  map[string]int64
	captures map[string]*paymentCapture
}

func (l *paymentLedger) capture(key string, provider *paymentProvider, cents int64) {
	l.captures[key] = &paymentCapture{provider.name, cents}
	l.settled[provider.name] += cents - provider.fee(cents)
}

func (l *paymentLedger) refund(key string, cents int64) bool {
	capture, ok := l.captures[key]
	if !ok || cents > capture.left {
		return false
	}
	capture.left -= cents
	l.settled[capture.provider] -= cents
	return true
}

// Routing: the order a charge tries providers in.
type paymentRouter struct {
	threshold int64
	preferred string
}

func (r *paymentRouter) order(providers []string, cents int64) []string {
	if r.preferred == "" || cents < r.threshold {
		return providers
	}
	out := []string{r.preferred}
	for _, p := range providers {
		if p != r.preferred {
			out = append(out, p)
		}
	}
	return out
}

func paymentNamed(text string) string {
	if text == "" {
		panic("an empty name")
	}
	return text
}

func checkedCents(cents int64) int64 {
	if cents < 1 || cents > maxCents {
		panic("cents are 1 to 10^7")
	}
	return cents
}

type PaymentOrchestrator struct {
	providers map[string]*paymentProvider
	outcomes  map[string]string
	ledger    *paymentLedger
	router    *paymentRouter
}

func NewPaymentOrchestrator() *PaymentOrchestrator {
	return &PaymentOrchestrator{
		providers: map[string]*paymentProvider{},
		outcomes:  map[string]string{},
		ledger:    &paymentLedger{map[string]int64{}, map[string]*paymentCapture{}},
		router:    &paymentRouter{},
	}
}

func (o *PaymentOrchestrator) provider(name string, kind string, feeBps int64) {
	rule, ok := feeRules[kind]
	if _, taken := o.providers[paymentNamed(name)]; taken || !ok {
		panic("a new provider of a known kind")
	}
	if feeBps < 0 || feeBps > maxFeeBps {
		panic("a fee is 0 to 1000 basis points")
	}
	o.providers[name] = &paymentProvider{name: name, rule: rule, bps: feeBps}
	o.ledger.settled[name] = 0
}

func (o *PaymentOrchestrator) failProvider(name string, times int64) {
	if times < 0 || times > maxFailures {
		panic("times is 0 to 1000")
	}
	o.known(name).failures = times
}

func (o *PaymentOrchestrator) charge(key string, customer string, cents int64, providers []string) string {
	paymentNamed(key)
	paymentNamed(customer)
	checkedCents(cents)
	distinct := map[string]bool{}
	for _, p := range providers {
		distinct[p] = true
	}
	if len(providers) == 0 || len(distinct) != len(providers) {
		panic("one or more distinct providers")
	}
	tried := []*paymentProvider{}
	for _, p := range o.router.order(providers, cents) {
		tried = append(tried, o.known(p))
	}
	if outcome, ok := o.outcomes[key]; ok {
		return outcome
	}
	outcome := chargeFailed
	for _, provider := range tried {
		if provider.attempt() {
			o.ledger.capture(key, provider, cents)
			outcome = "captured:" + provider.name
			break
		}
	}
	o.outcomes[key] = outcome
	return outcome
}

func (o *PaymentOrchestrator) refund(key string, cents int64) bool {
	if _, ok := o.outcomes[paymentNamed(key)]; !ok {
		panic("an unknown key")
	}
	return o.ledger.refund(key, checkedCents(cents))
}

func (o *PaymentOrchestrator) settled(provider string) int64 {
	return o.ledger.settled[o.known(provider).name]
}

// The extension round.
func (o *PaymentOrchestrator) routeByAmount(thresholdCents int64, provider string) {
	threshold := checkedCents(thresholdCents)
	o.router.threshold, o.router.preferred = threshold, o.known(provider).name
}

func (o *PaymentOrchestrator) known(name string) *paymentProvider {
	found, ok := o.providers[name]
	if !ok {
		panic("an unknown provider")
	}
	return found
}
