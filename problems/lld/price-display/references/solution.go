package main

import (
	"fmt"
	"strconv"
	"strings"
)

const (
	maxAmount = 1_000_000_000_000
	maxUnit   = 1_000_000_000
	maxQty    = 1000
)

// How one locale writes an amount. Every line asks this one place, so the same amount
// reads the same wherever it's shown.
type priceLocale struct {
	sign      string
	signFirst bool
	grouping  string
	decimal   string
}

func (l priceLocale) price(amount int64) string {
	whole, tail := amount, ""
	if l.decimal != "" {
		whole = amount / 100
		tail = fmt.Sprintf("%s%02d", l.decimal, amount%100)
	}
	digits := strconv.FormatInt(whole, 10)
	groups := []string{}
	for end := len(digits); end > 0; end -= 3 {
		groups = append([]string{digits[max(0, end-3):end]}, groups...)
	}
	number := strings.Join(groups, l.grouping) + tail
	if l.signFirst {
		return l.sign + number
	}
	return number + " " + l.sign
}

func checkedAmount(amount, most int64) int64 {
	if amount < 0 || amount > most {
		panic("amount out of range")
	}
	return amount
}

type PriceFormatter struct {
	locales map[string]priceLocale
}

func NewPriceFormatter() *PriceFormatter {
	return &PriceFormatter{locales: map[string]priceLocale{
		"en-US": {"$", true, ",", "."},
		"de-DE": {"EUR", false, ".", ","},
		"ja-JP": {"JPY", false, ",", ""},
	}}
}

func (f *PriceFormatter) locale(locale string) priceLocale {
	found, ok := f.locales[locale]
	if !ok {
		panic("unknown locale")
	}
	return found
}

func (f *PriceFormatter) checkoutLine(cents int64, locale string) string {
	return "Total: " + f.locale(locale).price(checkedAmount(cents, maxAmount))
}

func (f *PriceFormatter) receiptLine(item string, cents int64, qty int64, locale string) string {
	if item == "" {
		panic("an item has a name")
	}
	if qty < 1 || qty > maxQty {
		panic("qty must be within 1 and 1000")
	}
	found := f.locale(locale)
	unit := checkedAmount(cents, maxUnit)
	return fmt.Sprintf("%s %d x %s = %s", item, qty, found.price(unit), found.price(unit*qty))
}

func (f *PriceFormatter) emailSummary(totalCents int64, locale string) string {
	return "Your order comes to " + f.locale(locale).price(checkedAmount(totalCents, maxAmount)) + "."
}

// The extension round: a locale is data, so a new one changes no line's code.
func (f *PriceFormatter) addLocale(locale string, currencySign string, signFirst bool, grouping string, decimal string) {
	if _, taken := f.locales[locale]; locale == "" || taken {
		panic("a locale needs a new, non-empty name")
	}
	if currencySign == "" {
		panic("a currency has a sign")
	}
	f.locales[locale] = priceLocale{currencySign, signFirst, grouping, decimal}
}
