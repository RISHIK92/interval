package main

const (
	maxAttempts = 1000
	maxCapMs    = 1_000_000_000
)

// The one thing that varies between schedules: the delay before an attempt, at most
// ceiling. Growth stops at the ceiling, so no kind ever overflows.
type growth interface {
	delay(attempt, base, ceiling int64) int64
}

type fixedGrowth struct{}

func (fixedGrowth) delay(_, base, _ int64) int64 { return base }

type linearGrowth struct{}

func (linearGrowth) delay(attempt, base, ceiling int64) int64 { return min(base*attempt, ceiling) }

type exponentialGrowth struct{}

func (exponentialGrowth) delay(attempt, base, ceiling int64) int64 {
	d := base
	for a := int64(1); a < attempt && d < ceiling; a++ {
		d *= 2
	}
	return min(d, ceiling)
}

type fibonacciGrowth struct{}

func (fibonacciGrowth) delay(attempt, base, ceiling int64) int64 {
	previous, current := int64(0), base
	for a := int64(1); a < attempt && current < ceiling; a++ {
		previous, current = current, previous+current
	}
	return min(current, ceiling)
}

var growthKinds = map[string]growth{"fixed": fixedGrowth{}, "linear": linearGrowth{}, "exponential": exponentialGrowth{}}

func growthOf(kind string) growth {
	g, ok := growthKinds[kind]
	if !ok {
		panic("unknown kind")
	}
	return g
}

func count(n, low int64) {
	if n < low || n > maxAttempts {
		panic("attempts out of range")
	}
}

// Caps, schedules and totals are the same for every kind; only the growth is swapped.
type BackoffSchedule struct {
	growth  growth
	base    int64
	ceiling int64
}

func NewBackoffSchedule(kind string, baseMs int64, capMs int64) *BackoffSchedule {
	g := growthOf(kind)
	if baseMs < 1 || capMs < baseMs || capMs > maxCapMs {
		panic("1 <= baseMs <= capMs <= 10^9")
	}
	return &BackoffSchedule{growth: g, base: baseMs, ceiling: capMs}
}

func (b *BackoffSchedule) delay(attempt int64) int64 {
	count(attempt, 1)
	return b.growth.delay(attempt, b.base, b.ceiling)
}

func (b *BackoffSchedule) schedule(attempts int64) []int64 {
	count(attempts, 0)
	out := []int64{}
	for a := int64(1); a <= attempts; a++ {
		out = append(out, b.delay(a))
	}
	return out
}

func (b *BackoffSchedule) totalMs(attempts int64) int64 {
	sum := int64(0)
	for _, d := range b.schedule(attempts) {
		sum += d
	}
	return sum
}

func (b *BackoffSchedule) switchTo(kind string) {
	b.growth = growthOf(kind)
}

// The extension round: one more growth, and nothing else changes.
func (b *BackoffSchedule) fibonacci() {
	b.growth = fibonacciGrowth{}
}
