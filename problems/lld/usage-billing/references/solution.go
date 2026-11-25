package main

const (
	usageMaxUnits        = 1_000_000_000
	usageMaxRate         = 1_000_000
	usageMaxTiers        = 10
	usageMaxMinimumCents = 1_000_000_000
)

// How a metric turns a customer's units into cents.
type pricing interface {
	charge(units int64) int64
}

type usageTier struct{ start, rate int64 }

func checkedTiers(tiers [][]int64) []usageTier {
	if len(tiers) < 1 || len(tiers) > usageMaxTiers {
		panic("1-10 tiers")
	}
	out := []usageTier{}
	for i, t := range tiers {
		if len(t) != 2 {
			panic("each tier is [start, centsPerUnit]")
		}
		if (i == 0 && t[0] != 0) || (i > 0 && t[0] <= tiers[i-1][0]) {
			panic("starts begin at 0 and rise")
		}
		out = append(out, usageTier{t[0], t[1]})
	}
	if out[len(out)-1].start > usageMaxUnits {
		panic("starts up to 10^9")
	}
	for _, t := range out {
		if t.rate < 0 || t.rate > usageMaxRate {
			panic("rates within 0-10^6")
		}
	}
	return out
}

type graduated struct{ tiers []usageTier }

func (g graduated) charge(units int64) int64 {
	total := int64(0)
	for i := len(g.tiers) - 1; i >= 0; i-- {
		above := units - g.tiers[i].start
		if above < 0 {
			above = 0
		}
		total += above * g.tiers[i].rate
		units -= above
	}
	return total
}

type volume struct{ tiers []usageTier }

func (v volume) charge(units int64) int64 {
	i := len(v.tiers) - 1
	for v.tiers[i].start >= units {
		i--
	}
	return units * v.tiers[i].rate
}

type UsageBilling struct {
	pricing  map[string]pricing
	minimums map[string]int64
	usage    map[string]map[string]int64
}

func NewUsageBilling() *UsageBilling {
	return &UsageBilling{
		pricing:  map[string]pricing{},
		minimums: map[string]int64{},
		usage:    map[string]map[string]int64{},
	}
}

func (b *UsageBilling) price(metric string, model string, tiers [][]int64) {
	if metric == "" {
		panic("a named metric")
	}
	var p pricing
	switch model {
	case "graduated":
		p = graduated{checkedTiers(tiers)}
	case "volume":
		p = volume{checkedTiers(tiers)}
	default:
		panic("unknown model")
	}
	b.pricing[metric] = p
}

func (b *UsageBilling) meter(customer string, metric string, units int64) {
	if _, ok := b.pricing[metric]; customer == "" || !ok || units < 1 || units > usageMaxUnits {
		panic("a customer, a priced metric and 1-10^9 units")
	}
	if b.usage[customer] == nil {
		b.usage[customer] = map[string]int64{}
	}
	b.usage[customer][metric] += units
}

func (b *UsageBilling) line(metric string, units int64) int64 {
	charge := b.pricing[metric].charge(units)
	if least, ok := b.minimums[metric]; ok && least > charge {
		return least
	}
	return charge
}

func (b *UsageBilling) invoice(customer string) map[string]int64 {
	out := map[string]int64{}
	for metric, units := range b.usage[customer] {
		out[metric] = b.line(metric, units)
	}
	return out
}

func (b *UsageBilling) total(customer string) int64 {
	sum := int64(0)
	for _, cents := range b.invoice(customer) {
		sum += cents
	}
	return sum
}

// The extension round.
func (b *UsageBilling) minimum(metric string, cents int64) {
	if _, ok := b.pricing[metric]; !ok || cents < 0 || cents > usageMaxMinimumCents {
		panic("a priced metric and 0-10^9 cents")
	}
	b.minimums[metric] = cents
}
