package main

import (
	"regexp"
	"slices"
	"strings"
)

// P5-W33 (§6.9, Q-P5-20): code similarity in the human league. Two players' best
// submissions in the same language are tokenized, identifiers and literals masked, and
// compared as 4-token shingles: the share of the shorter one's shingles also in the
// other's. At or over similarAt, both get a `similar` signal for review; nothing more.
const (
	similarAt = 0.85
	shingle   = 4
	// Fewer of a player's own shingles than this (the starter left out) is too little
	// code to call anything copied.
	minShingles = 20
)

var token = regexp.MustCompile(`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_][A-Za-z0-9_]*|[0-9][0-9._]*|\S`)

// Words kept as they are: structure, not names. A union across the six languages.
var keywords = map[string]bool{}

func init() {
	for _, k := range strings.Fields(`if else elif for while do return break continue switch case
		default class struct interface def func function fn const let var new delete try catch
		except finally throw raise import from package public private protected static void
		int long double float bool boolean string char auto true false null nil None True False
		this self super lambda yield async await with in is not and or of map range go defer
		select chan type extends implements override virtual template typename final`) {
		keywords[k] = true
	}
}

// Comments are no code: interleaving them mustn't hide a copy. A "#" line or "//" to the
// end of a line, and "/* */" blocks. shortcut: a "#" or "//" inside a string is taken as
// a comment too; fine for masking, as strings are masked anyway.
var comment = regexp.MustCompile(`(?s)/\*.*?\*/|//[^\n]*|#[^\n]*`)

func tokens(code string) []string {
	out := []string{}
	for _, t := range token.FindAllString(comment.ReplaceAllString(code, " "), -1) {
		switch {
		case t[0] == '"' || t[0] == '\'' || (t[0] >= '0' && t[0] <= '9'):
			out = append(out, "L")
		case t[0] == '_' || (t[0]|0x20 >= 'a' && t[0]|0x20 <= 'z'):
			if keywords[t] {
				out = append(out, t)
			} else {
				out = append(out, "I")
			}
		default:
			out = append(out, t)
		}
	}
	return out
}

func shingles(ts []string) map[string]int {
	out := map[string]int{}
	for i := 0; i+shingle <= len(ts); i++ {
		out[strings.Join(ts[i:i+shingle], " ")]++
	}
	return out
}

// The share, 0 to 1, of the smaller submission's shingles found in the other's, leaving
// out the starters' (code everyone was given isn't copied); 0 when under half of the
// larger one's are shared too, so a short skeleton inside a full solution isn't a copy.
func similarity(a, b string, starters ...string) float64 {
	x, y := shingles(tokens(a)), shingles(tokens(b))
	for _, starter := range starters {
		for s := range shingles(tokens(starter)) {
			delete(x, s)
			delete(y, s)
		}
	}
	total := func(m map[string]int) int {
		n := 0
		for _, c := range m {
			n += c
		}
		return n
	}
	if total(x) > total(y) {
		x, y = y, x
	}
	if total(x) < minShingles {
		return 0
	}
	common := 0
	for s, c := range x {
		common += min(c, y[s])
	}
	if float64(common) < 0.5*float64(total(y)) {
		return 0
	}
	return float64(common) / float64(total(x))
}

// Each pair of players whose best submissions, in the same language, are similar.
func similarPairs(best map[string]*codeMsg, starters ...map[string]string) [][2]string {
	players := make([]string, 0, len(best))
	for p := range best {
		players = append(players, p)
	}
	slices.Sort(players)
	var out [][2]string
	for i, p := range players {
		for _, q := range players[i+1:] {
			language := best[p].language
			given := make([]string, 0, len(starters))
			for _, s := range starters {
				given = append(given, s[language])
			}
			if language == best[q].language && similarity(best[p].code, best[q].code, given...) >= similarAt {
				out = append(out, [2]string{p, q})
			}
		}
	}
	return out
}
