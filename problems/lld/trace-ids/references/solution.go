package main

import (
	"fmt"
	"strconv"
	"strings"
)

const (
	traceMaxNode = 1023
	traceMaxMs   = 1_000_000_000_000
	tracePerMs   = 1000 // sequences 000 to 999 in one millisecond
)

var traceWidths = []int{13, 4, 3} // timestamp, node, sequence

// The process's one ID source. Every caller shares this instance, so the last timestamp
// and its sequence live here and nowhere else: two sources on one node could issue the
// same ID, which is why there is only ever one.
type TraceIds struct {
	node     int64
	ms       int64
	sequence int64
	count    int64
}

func NewTraceIds(nodeId int64) *TraceIds {
	if nodeId < 0 || nodeId > traceMaxNode {
		panic("node out of range")
	}
	return &TraceIds{node: nodeId, ms: -1}
}

func (t *TraceIds) nextId(nowMs int64) string {
	if nowMs < 0 || nowMs > traceMaxMs {
		panic("time out of range")
	}
	if nowMs > t.ms {
		t.ms = nowMs
		t.sequence = 0
	} else if t.sequence+1 < tracePerMs {
		// The same millisecond, or a clock that went backwards: stay on the last one.
		t.sequence++
	} else {
		// A full millisecond borrows the next one, so IDs keep sorting in issue order.
		t.ms++
		t.sequence = 0
	}
	t.count++
	return fmt.Sprintf("%013d-%04d-%03d", t.ms, t.node, t.sequence)
}

func (t *TraceIds) issued() int64 { return t.count }

func (t *TraceIds) lastMs() int64 { return t.ms }

// The extension round: reading an ID back.
func (t *TraceIds) decode(traceId string) []int64 {
	parts := strings.Split(traceId, "-")
	if len(parts) != len(traceWidths) {
		panic("not a trace ID")
	}
	values := []int64{}
	for i, part := range parts {
		if len(part) != traceWidths[i] || strings.Trim(part, "0123456789") != "" {
			panic("not a trace ID")
		}
		value, err := strconv.ParseInt(part, 10, 64)
		if err != nil {
			panic(err)
		}
		values = append(values, value)
	}
	if values[1] > traceMaxNode {
		panic("node out of range")
	}
	return values
}
