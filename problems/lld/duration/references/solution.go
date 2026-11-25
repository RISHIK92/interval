package main

import (
	"fmt"
	"math"
	"regexp"
	"strconv"
)

var durationPattern = regexp.MustCompile(`^(?:([0-9]{1,9})h)?(?:([0-9]{1,9})m)?(?:([0-9]{1,9})s)?$`)

func durationSeconds(text string) int64 {
	m := durationPattern.FindStringSubmatch(text)
	if text == "" || m == nil {
		panic("a duration is like 1h30m15s")
	}
	part := func(i int) int64 {
		if m[i] == "" {
			return 0
		}
		n, err := strconv.ParseInt(m[i], 10, 64)
		if err != nil {
			panic(err)
		}
		return n
	}
	return part(1)*3600 + part(2)*60 + part(3)
}

func durationCanonical(total int64) string {
	if total == 0 {
		return "0s"
	}
	out := ""
	if total/3600 > 0 {
		out += fmt.Sprintf("%dh", total/3600)
	}
	if total/60%60 > 0 {
		out += fmt.Sprintf("%dm", total/60%60)
	}
	if total%60 > 0 {
		out += fmt.Sprintf("%ds", total%60)
	}
	return out
}

type Duration struct {
	total int64
}

func NewDuration(text string) *Duration {
	return &Duration{total: durationSeconds(text)}
}

func (d *Duration) totalSeconds() int64 {
	return d.total
}

func (d *Duration) canonical() string {
	return durationCanonical(d.total)
}

func (d *Duration) plus(other string) string {
	return durationCanonical(d.total + durationSeconds(other))
}

func (d *Duration) isLonger(other string) bool {
	return d.total > durationSeconds(other)
}

// The extension round.
func (d *Duration) scaled(factor float64) string {
	if factor < 0 || factor > 1000 {
		panic("factor must be within 0-1000")
	}
	return durationCanonical(int64(math.Floor(float64(d.total) * factor)))
}
