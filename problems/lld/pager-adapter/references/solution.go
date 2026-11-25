package main

import (
	"strconv"
	"strings"
)

// The incident API's severities as the legacy pager's levels, and back: five levels fold
// into three severities.
var paToLevel = map[string]string{"sev1": "1", "sev2": "3", "sev3": "5"}
var paToSeverity = map[string]string{"1": "sev1", "2": "sev1", "3": "sev2", "4": "sev3", "5": "sev3"}

const paMaxCode = 9999

type paPage struct {
	team, code string
	acked      bool
}

// Lets the incident API (team names, sev1 to sev3) drive a legacy pager (numeric team
// codes, levels 1 to 5): pages go out as legacy lines, and the pager's acknowledgements
// come back as the API's words. Numbers are kept as the text the pager sees.
type PagerAdapter struct {
	codes map[string]string
	sent  map[string]*paPage
}

func NewPagerAdapter(teamCodes map[string]int64) *PagerAdapter {
	a := &PagerAdapter{codes: map[string]string{}, sent: map[string]*paPage{}}
	taken := map[string]bool{}
	for team, code := range teamCodes {
		if team == "" || code < 1 || code > paMaxCode {
			panic("bad team or code")
		}
		a.codes[team] = strconv.FormatInt(code, 10)
		taken[a.codes[team]] = true
	}
	if len(taken) != len(a.codes) {
		panic("two teams share a code")
	}
	return a
}

func (a *PagerAdapter) page(team string, severity string, summary string) string {
	code, known := a.codes[team]
	level, valid := paToLevel[severity]
	if !known || !valid || summary == "" {
		panic("unknown team or severity, or no summary")
	}
	number := strconv.Itoa(len(a.sent) + 1)
	a.sent[number] = &paPage{team: team, code: code}
	return "PAGE " + number + " " + code + " " + level + " " + summary
}

func (a *PagerAdapter) ack(legacyLine string) *string {
	if legacyLine == "" {
		panic("empty line")
	}
	fields := strings.Split(legacyLine, " ")
	if len(fields) != 4 || fields[0] != "ACK" {
		return nil
	}
	page, sent := a.sent[fields[1]]
	severity, valid := paToSeverity[fields[3]]
	if !sent || page.acked || page.code != fields[2] || !valid {
		return nil
	}
	page.acked = true
	out := page.team + " acked page " + fields[1] + " at " + severity
	return &out
}

func (a *PagerAdapter) pages() int64 {
	return int64(len(a.sent))
}
