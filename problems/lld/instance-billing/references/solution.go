package main

const (
	billingMaxRate  = 1_000_000
	billingMaxHours = 10_000
)

// One instance: the hours it has run. Each kind turns them into cents its own way.
type billable interface {
	run(hours int64)
	bill() int64
	interrupt() bool
}

type meteredHours struct {
	hourly int64
	hours  int64
}

func (m *meteredHours) run(hours int64) { m.hours += hours }

func (m *meteredHours) interrupt() bool { panic("only a spot instance can be interrupted") }

type onDemand struct{ meteredHours }

func (o *onDemand) bill() int64 { return o.hours * o.hourly }

type reserved struct{ meteredHours }

// 100 hours paid up front, then 60% of the rate over all the hours run.
func (r *reserved) bill() int64 { return 100*r.hourly + r.hours*r.hourly*60/100 }

type spot struct {
	meteredHours
	interrupted bool
}

// Once interrupted, runs are still accepted but no longer billed.
func (s *spot) run(hours int64) {
	if !s.interrupted {
		s.meteredHours.run(hours)
	}
}

func (s *spot) bill() int64 { return s.hours * s.hourly * 30 / 100 }

func (s *spot) interrupt() bool {
	first := !s.interrupted
	s.interrupted = true
	return first
}

type dedicated struct {
	meteredHours
	hostFee int64
	runs    int64
}

func (d *dedicated) run(hours int64) {
	d.meteredHours.run(hours)
	d.runs++
}

func (d *dedicated) bill() int64 { return d.hours*d.hourly + d.runs*d.hostFee }

var billingKinds = map[string]func(hourly int64) billable{
	"on-demand": func(h int64) billable { return &onDemand{meteredHours{hourly: h}} },
	"reserved":  func(h int64) billable { return &reserved{meteredHours{hourly: h}} },
	"spot":      func(h int64) billable { return &spot{meteredHours: meteredHours{hourly: h}} },
}

func billingRate(cents int64) int64 {
	if cents < 1 || cents > billingMaxRate {
		panic("hourlyCents must be within 1 and 10^6")
	}
	return cents
}

type BillingMeter struct {
	instances map[string]billable
}

func NewBillingMeter() *BillingMeter {
	return &BillingMeter{instances: map[string]billable{}}
}

func (b *BillingMeter) add(id string, i billable) {
	if _, taken := b.instances[id]; id == "" || taken {
		panic("an instance needs a new, non-empty id")
	}
	b.instances[id] = i
}

func (b *BillingMeter) find(id string) billable {
	i, ok := b.instances[id]
	if !ok {
		panic("no such instance")
	}
	return i
}

func (b *BillingMeter) launch(id string, kind string, hourlyCents int64) {
	create, ok := billingKinds[kind]
	if !ok {
		panic("unknown kind")
	}
	b.add(id, create(billingRate(hourlyCents)))
}

func (b *BillingMeter) run(id string, hours int64) {
	if hours < 1 || hours > billingMaxHours {
		panic("hours must be within 1 and 10^4")
	}
	b.find(id).run(hours)
}

func (b *BillingMeter) bill(id string) int64 {
	return b.find(id).bill()
}

func (b *BillingMeter) total() int64 {
	sum := int64(0)
	for _, i := range b.instances {
		sum += i.bill()
	}
	return sum
}

func (b *BillingMeter) interrupt(id string) bool {
	return b.find(id).interrupt()
}

// The extension round: a fourth kind, added without touching the others.
func (b *BillingMeter) launchDedicated(id string, hourlyCents int64, hostFeeCents int64) {
	if hostFeeCents < 0 || hostFeeCents > billingMaxRate {
		panic("hostFeeCents must be within 0 and 10^6")
	}
	b.add(id, &dedicated{meteredHours: meteredHours{hourly: billingRate(hourlyCents)}, hostFee: hostFeeCents})
}
