package main

import "sort"

const maxVersion = 1_000_000_000

// A broken precondition fails the call before anything changes.
func precondition(condition bool, why string) {
	if !condition {
		panic(why)
	}
}

// Invariant: the applied migrations are exactly the lowest `applied` versions, so the
// current version is the last of them and everything above it is pending.
type MigrationPlan struct {
	names    map[int64]string
	versions []int64
	applied  int
	locked   map[int64]bool
}

func NewMigrationPlan() *MigrationPlan {
	return &MigrationPlan{names: map[int64]string{}, locked: map[int64]bool{}}
}

// How many of the sorted versions are at or below `version`.
func (p *MigrationPlan) countUpTo(version int64) int {
	return sort.Search(len(p.versions), func(i int) bool { return p.versions[i] > version })
}

func (p *MigrationPlan) add(version int64, name string) {
	precondition(version >= 1 && version <= maxVersion, "versions are within 1 and 10^9")
	precondition(name != "", "a migration has a name")
	_, planned := p.names[version]
	precondition(!planned, "that version is already planned")
	// It must land above every applied migration, or it could never be applied.
	precondition(version > p.current(), "that version is below the current one")
	p.names[version] = name
	at := p.countUpTo(version)
	p.versions = append(p.versions[:at], append([]int64{version}, p.versions[at:]...)...)
}

func (p *MigrationPlan) applyUpTo(version int64) []string {
	_, planned := p.names[version]
	precondition(planned, "unknown version")
	precondition(version >= p.current(), "applying never goes down")
	start := p.applied
	p.applied = p.countUpTo(version)
	out := []string{}
	for _, v := range p.versions[start:p.applied] {
		out = append(out, p.names[v])
	}
	return out
}

func (p *MigrationPlan) rollback(steps int64) []string {
	precondition(steps >= 1 && steps <= int64(p.applied), "steps are within 1 and the applied count")
	undone := []int64{}
	for i := p.applied - 1; i >= p.applied-int(steps); i-- {
		precondition(!p.locked[p.versions[i]], "an irreversible migration is in the way")
		undone = append(undone, p.versions[i])
	}
	p.applied -= int(steps)
	out := []string{}
	for _, v := range undone {
		out = append(out, p.names[v])
	}
	return out
}

func (p *MigrationPlan) current() int64 {
	if p.applied == 0 {
		return 0
	}
	return p.versions[p.applied-1]
}

func (p *MigrationPlan) pending() []int64 {
	return append([]int64{}, p.versions[p.applied:]...)
}

// The extension round: one more precondition on rollback.
func (p *MigrationPlan) irreversible(version int64) {
	_, planned := p.names[version]
	precondition(planned, "unknown version")
	p.locked[version] = true
}
