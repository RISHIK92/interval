package main

import (
	"sort"
	"strings"
)

type infraResources map[string]map[string]string

func infraCopy(from infraResources) infraResources {
	out := infraResources{}
	for name, attrs := range from {
		inner := map[string]string{}
		for k, v := range attrs {
			inner[k] = v
		}
		out[name] = inner
	}
	return out
}

// The memento: a frozen copy of the state that only InfraState reads back.
type infraSnapshot struct {
	label string
	saved infraResources
}

func (s *infraSnapshot) resources() infraResources { return infraCopy(s.saved) }

type InfraState struct {
	current infraResources
	// The caretaker's side: snapshots by id, known here only by their labels.
	snapshots map[int64]*infraSnapshot
	lastID    int64
}

func NewInfraState() *InfraState {
	return &InfraState{current: infraResources{}, snapshots: map[int64]*infraSnapshot{}}
}

func (s *InfraState) apply(resource string, attrs map[string]string) {
	empty := resource == ""
	for k, v := range attrs {
		empty = empty || k == "" || v == ""
	}
	if empty {
		panic("empty name or value")
	}
	kept := map[string]string{}
	for k, v := range attrs {
		kept[k] = v
	}
	s.current[resource] = kept
}

func (s *InfraState) destroy(resource string) bool {
	if resource == "" {
		panic("empty resource")
	}
	_, ok := s.current[resource]
	delete(s.current, resource)
	return ok
}

func (s *InfraState) snapshot(label string) int64 {
	if label == "" {
		panic("empty label")
	}
	for id, snap := range s.snapshots {
		if snap.label == label {
			delete(s.snapshots, id)
		}
	}
	s.lastID++
	s.snapshots[s.lastID] = &infraSnapshot{label: label, saved: infraCopy(s.current)}
	return s.lastID
}

func (s *InfraState) restore(snapshotId int64) bool {
	snap, ok := s.snapshots[snapshotId]
	if !ok {
		return false
	}
	s.current = snap.resources()
	return true
}

func (s *InfraState) diffSince(snapshotId int64) []string {
	snap, ok := s.snapshots[snapshotId]
	if !ok {
		panic("unknown snapshot")
	}
	then := snap.resources()
	out := []string{}
	for _, name := range infraUnion(then, s.current) {
		before, wasThere := then[name]
		now, isThere := s.current[name]
		switch {
		case !wasThere:
			out = append(out, "+ "+name)
		case !isThere:
			out = append(out, "- "+name)
		default:
			keys := []string{}
			for _, k := range infraUnion(before, now) {
				a, inA := before[k]
				b, inB := now[k]
				if inA != inB || a != b {
					keys = append(keys, k)
				}
			}
			if len(keys) > 0 {
				out = append(out, "~ "+name+": "+strings.Join(keys, ","))
			}
		}
	}
	return out
}

// The extension round: keeping only the newest snapshots.
func (s *InfraState) prune(keep int64) int64 {
	if keep < 0 {
		panic("negative keep")
	}
	ids := make([]int64, 0, len(s.snapshots))
	for id := range s.snapshots {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	dropped := int64(len(ids)) - keep
	if dropped < 0 {
		dropped = 0
	}
	for _, id := range ids[:dropped] {
		delete(s.snapshots, id)
	}
	return dropped
}

// The sorted union of two maps' keys.
func infraUnion[V any](a, b map[string]V) []string {
	seen := map[string]bool{}
	for k := range a {
		seen[k] = true
	}
	for k := range b {
		seen[k] = true
	}
	out := make([]string, 0, len(seen))
	for k := range seen {
		out = append(out, k)
	}
	sort.Strings(out)
	return out
}
