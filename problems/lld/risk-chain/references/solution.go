package main

const riskWindowMs = 60000

type riskPayment struct {
	customer string
	cents    int64
	country  string
	nowMs    int64
}

// What the checks may look at besides the payment: shared by the whole chain.
type riskHistory struct {
	blocked map[string]bool
	home    map[string]string
	recent  map[string][]int64
}

func (h *riskHistory) remember(p riskPayment) {
	if _, ok := h.home[p.customer]; !ok {
		h.home[p.customer] = p.country
	}
	times := append(h.recent[p.customer], p.nowMs)
	// Times never decrease, so the ones that left the window are at the front.
	kept := 0
	for kept < len(times) && times[kept] <= p.nowMs-riskWindowMs {
		kept++
	}
	h.recent[p.customer] = times[kept:]
}

// One link: it decides the payment, or returns "" to pass it to the next link.
type riskCheck interface {
	kind() string
	decide(p riskPayment, h *riskHistory) string
}

type blocklistCheck struct{}

func (blocklistCheck) kind() string { return "blocklist" }
func (blocklistCheck) decide(p riskPayment, h *riskHistory) string {
	if h.blocked[p.customer] {
		return "block"
	}
	return ""
}

type velocityCheck struct{ most int64 }

func (velocityCheck) kind() string { return "velocity" }
func (c velocityCheck) decide(p riskPayment, h *riskHistory) string {
	if int64(len(h.recent[p.customer])) > c.most {
		return "review"
	}
	return ""
}

type amountCheck struct{ limit int64 }

func (amountCheck) kind() string { return "amount" }
func (c amountCheck) decide(p riskPayment, h *riskHistory) string {
	if p.cents > c.limit {
		return "block"
	}
	return ""
}

type countryCheck struct{}

func (countryCheck) kind() string { return "country" }
func (countryCheck) decide(p riskPayment, h *riskHistory) string {
	if h.home[p.customer] != p.country {
		return "review"
	}
	return ""
}

// Each kind with the least param it accepts; blocklist and country take none, so only 0.
type riskKind struct {
	make  func(param int64) riskCheck
	low   int64
	takes bool
}

var riskKinds = map[string]riskKind{
	"blocklist": {func(int64) riskCheck { return blocklistCheck{} }, 0, false},
	"velocity":  {func(n int64) riskCheck { return velocityCheck{n} }, 1, true},
	"amount":    {func(n int64) riskCheck { return amountCheck{n} }, 0, true},
	"country":   {func(int64) riskCheck { return countryCheck{} }, 0, false},
}

type riskSkip struct{ customer, check string }

type RiskChain struct {
	checks  []riskCheck
	history *riskHistory
	counts  map[string]int64
	skips   map[riskSkip]bool
}

func NewRiskChain() *RiskChain {
	return &RiskChain{
		history: &riskHistory{blocked: map[string]bool{}, home: map[string]string{}, recent: map[string][]int64{}},
		counts:  map[string]int64{"allow": 0, "review": 0, "block": 0},
		skips:   map[riskSkip]bool{},
	}
}

func (r *RiskChain) addCheck(check string, param int64) {
	kind, ok := riskKinds[check]
	if !ok {
		panic("unknown check")
	}
	if param < kind.low || (param != kind.low && !kind.takes) {
		panic("param out of range")
	}
	r.checks = append(r.checks, kind.make(param))
}

func (r *RiskChain) block(customer string) {
	if customer == "" {
		panic("empty customer")
	}
	r.history.blocked[customer] = true
}

func (r *RiskChain) assess(customer string, cents int64, country string, nowMs int64) string {
	if customer == "" || country == "" || cents < 1 {
		panic("bad payment")
	}
	p := riskPayment{customer, cents, country, nowMs}
	r.history.remember(p)
	verdict := "allow"
	for _, check := range r.checks {
		if r.skips[riskSkip{customer, check.kind()}] {
			continue
		}
		if decided := check.decide(p, r.history); decided != "" {
			verdict = decided
			break
		}
	}
	r.counts[verdict]++
	return verdict
}

func (r *RiskChain) decisions(verdict string) int64 {
	count, ok := r.counts[verdict]
	if !ok {
		panic("unknown verdict")
	}
	return count
}

// The extension round: trusted customers skip a kind of check.
func (r *RiskChain) skipFor(customer string, check string) bool {
	if _, ok := riskKinds[check]; customer == "" || !ok {
		panic("bad skip")
	}
	key := riskSkip{customer, check}
	if r.skips[key] {
		return false
	}
	r.skips[key] = true
	return true
}
