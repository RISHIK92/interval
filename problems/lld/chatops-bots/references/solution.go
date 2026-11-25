package main

import (
	"sort"
	"strings"
)

// One thing a bot can do. A bot is the abilities it holds, never a type per mix.
type ability interface {
	takesArgument() bool
	answer(bot, argument string) string
}

type acts struct{ done string }

func (a acts) takesArgument() bool              { return true }
func (a acts) answer(_, argument string) string { return a.done + " " + argument }

type status struct{}

func (status) takesArgument() bool         { return false }
func (status) answer(bot, _ string) string { return bot + " ok" }

// Wraps any ability and logs each command it answers; the answer is unchanged.
type audited struct {
	verb  string
	inner ability
	log   *[]string
}

func (a audited) takesArgument() bool { return a.inner.takesArgument() }

func (a audited) answer(bot, argument string) string {
	reply := a.inner.answer(bot, argument)
	command := a.verb
	if a.takesArgument() {
		command += " " + argument
	}
	*a.log = append(*a.log, command+" -> "+reply)
	return reply
}

var knownAbilities = map[string]ability{
	"deploy": acts{"deployed"},
	"page":   acts{"paged"},
	"query":  acts{"queried"},
	"status": status{},
}

func abilityNamed(name string) ability {
	found, ok := knownAbilities[name]
	if !ok {
		panic("unknown ability")
	}
	return found
}

type chatBot struct {
	held map[string]ability
	log  *[]string
}

func (b *chatBot) equip(name string) {
	base := abilityNamed(name)
	if b.log == nil {
		b.held[name] = base
	} else {
		b.held[name] = audited{name, base, b.log}
	}
}

type BotFleet struct {
	bots map[string]*chatBot
}

func NewBotFleet() *BotFleet {
	return &BotFleet{bots: map[string]*chatBot{}}
}

func (f *BotFleet) bot(bot string) *chatBot {
	found, ok := f.bots[bot]
	if !ok {
		panic("unknown bot")
	}
	return found
}

func (f *BotFleet) create(bot string, abilities []string) {
	if _, taken := f.bots[bot]; bot == "" || taken {
		panic("a bot needs a new, non-empty name")
	}
	seen := map[string]bool{}
	for _, name := range abilities {
		abilityNamed(name)
		if seen[name] {
			panic("an ability is listed twice")
		}
		seen[name] = true
	}
	made := &chatBot{held: map[string]ability{}}
	for _, name := range abilities {
		made.equip(name)
	}
	f.bots[bot] = made
}

func (f *BotFleet) grant(bot string, name string) bool {
	found := f.bot(bot)
	abilityNamed(name)
	if _, ok := found.held[name]; ok {
		return false
	}
	found.equip(name)
	return true
}

func (f *BotFleet) revoke(bot string, name string) bool {
	found := f.bot(bot)
	abilityNamed(name)
	_, ok := found.held[name]
	delete(found.held, name)
	return ok
}

func (f *BotFleet) handle(bot string, command string) string {
	found := f.bot(bot)
	verb, argument, spaced := strings.Cut(command, " ")
	shape := abilityNamed(verb)
	fits := !spaced
	if shape.takesArgument() {
		fits = argument != ""
	}
	if !fits {
		panic("the command doesn't fit its ability")
	}
	held, ok := found.held[verb]
	if !ok {
		return "refused"
	}
	return held.answer(bot, argument)
}

func (f *BotFleet) abilities(bot string) []string {
	out := []string{}
	for name := range f.bot(bot).held {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// The extension round: auditing wraps each ability the bot holds, now and later.
func (f *BotFleet) audit(bot string) {
	found := f.bot(bot)
	if found.log != nil {
		return
	}
	found.log = &[]string{}
	for name := range found.held {
		found.equip(name)
	}
}

func (f *BotFleet) auditLog(bot string) []string {
	found := f.bot(bot)
	if found.log == nil {
		return []string{}
	}
	return append([]string{}, *found.log...)
}
