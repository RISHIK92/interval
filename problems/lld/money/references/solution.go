package main

import (
	"fmt"
	"regexp"
)

const moneyLimit = 1_000_000_000_000

var currencyPattern = regexp.MustCompile(`^[A-Z]{3}$`)

func checkedMoney(cents int64, currency string) {
	if cents < 0 || cents > moneyLimit {
		panic("cents must be within 0 and 10^12")
	}
	if !currencyPattern.MatchString(currency) {
		panic("a currency is three capital letters")
	}
}

type Money struct {
	cents    int64
	currency string
}

func NewMoney(cents int64, currency string) *Money {
	checkedMoney(cents, currency)
	return &Money{cents: cents, currency: currency}
}

func (m *Money) show(amount int64) string {
	return fmt.Sprintf("%s %d.%02d", m.currency, amount/100, amount%100)
}

func (m *Money) add(cents int64, currency string) string {
	checkedMoney(cents, currency)
	if currency != m.currency {
		panic("can't add across currencies")
	}
	return m.show(m.cents + cents)
}

func (m *Money) split(parts int64) []string {
	if parts < 1 || parts > 100 {
		panic("parts must be within 1-100")
	}
	share, left := m.cents/parts, m.cents%parts
	out := []string{}
	for i := int64(0); i < parts; i++ {
		extra := int64(0)
		if i < left {
			extra = 1
		}
		out = append(out, m.show(share+extra))
	}
	return out
}

func (m *Money) display() string {
	return m.show(m.cents)
}

// The extension round.
func (m *Money) allocate(weights []int64) []string {
	if len(weights) < 1 || len(weights) > 100 {
		panic("1-100 weights")
	}
	total := int64(0)
	for _, w := range weights {
		if w < 0 || w > 1000 {
			panic("each weight within 0-1000")
		}
		total += w
	}
	if total == 0 {
		panic("at least one weight above 0")
	}
	shares := make([]int64, len(weights))
	left := m.cents
	for i, w := range weights {
		shares[i] = m.cents * w / total
		left -= shares[i]
	}
	for i, w := range weights {
		if left > 0 && w > 0 {
			shares[i]++
			left--
		}
	}
	out := []string{}
	for _, s := range shares {
		out = append(out, m.show(s))
	}
	return out
}
