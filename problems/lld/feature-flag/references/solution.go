package main

type FeatureFlag struct {
	name    string
	percent int64
	killed  bool
	allowed map[int64]bool
}

func checkedPercent(percent int64) int64 {
	if percent < 0 || percent > 100 {
		panic("percent must be within 0-100")
	}
	return percent
}

func checkedBucket(bucket int64) int64 {
	if bucket < 0 || bucket > 99 {
		panic("bucket must be within 0-99")
	}
	return bucket
}

func NewFeatureFlag(name string, rolloutPercent int64) *FeatureFlag {
	if name == "" {
		panic("a flag needs a name")
	}
	return &FeatureFlag{name: name, percent: checkedPercent(rolloutPercent), allowed: map[int64]bool{}}
}

func (f *FeatureFlag) enabledFor(userBucket int64) bool {
	bucket := checkedBucket(userBucket)
	if f.killed {
		return false
	}
	return f.allowed[bucket] || bucket < f.percent
}

func (f *FeatureFlag) setRollout(percent int64) {
	f.percent = checkedPercent(percent)
}

func (f *FeatureFlag) kill() {
	f.killed = true
}

func (f *FeatureFlag) revive() {
	f.killed = false
}

// The extension round.
func (f *FeatureFlag) allow(userBucket int64) {
	f.allowed[checkedBucket(userBucket)] = true
}
