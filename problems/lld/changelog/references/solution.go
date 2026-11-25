package main

import "regexp"

// Parsing, grouping and rendering are three units with one reason to change each: a new
// message syntax touches only the parser, a new section only the grouper, a new layout
// only the renderer. Changelog just keeps the commits and wires the three together.

var commitHeader = regexp.MustCompile(`^([a-z]+)(?:\(([^()]+)\))?(!?): (.+)$`)

type changelogEntry struct {
	sha, kind, description string
	scope                  *string
	breaking               bool
}

func parseCommit(sha, message string) *changelogEntry {
	found := commitHeader.FindStringSubmatchIndex(message)
	if found == nil {
		return nil
	}
	part := func(i int) string { return message[found[2*i]:found[2*i+1]] }
	entry := &changelogEntry{sha: sha, kind: part(1), breaking: part(3) == "!", description: part(4)}
	if found[4] >= 0 {
		scope := part(2)
		entry.scope = &scope
	}
	return entry
}

type changelogSection struct {
	title   string
	entries []changelogEntry
}

// Sections by type, in the order they print; every other type goes under "Other".
var typeSections = []struct{ kind, title string }{{"feat", "Features"}, {"fix", "Fixes"}}

func sectionOf(kind string) string {
	for _, s := range typeSections {
		if s.kind == kind {
			return s.title
		}
	}
	return "Other"
}

func groupEntries(entries []changelogEntry, breakingFirst bool) []changelogSection {
	titles := []string{}
	if breakingFirst {
		titles = append(titles, "BREAKING")
	}
	for _, s := range typeSections {
		titles = append(titles, s.title)
	}
	titles = append(titles, "Other")
	listed := map[string][]changelogEntry{}
	for _, entry := range entries {
		title := sectionOf(entry.kind)
		if breakingFirst && entry.breaking {
			title = "BREAKING"
		}
		listed[title] = append(listed[title], entry)
	}
	out := []changelogSection{}
	for _, title := range titles {
		if len(listed[title]) > 0 {
			out = append(out, changelogSection{title, listed[title]})
		}
	}
	return out
}

func renderRelease(version string, sections []changelogSection) []string {
	lines := []string{"## " + version}
	for _, section := range sections {
		lines = append(lines, "### "+section.title)
		for _, entry := range section.entries {
			scope := ""
			if entry.scope != nil {
				scope = *entry.scope + ": "
			}
			sha := entry.sha
			if len(sha) > 7 {
				sha = sha[:7]
			}
			lines = append(lines, "- "+scope+entry.description+" ("+sha+")")
		}
	}
	return lines
}

func changelogGiven(value string) {
	if value == "" {
		panic("empty")
	}
}

type Changelog struct {
	pending       []changelogEntry
	shas          map[string]bool
	versions      map[string]bool
	breakingFirst bool
}

func NewChangelog() *Changelog {
	return &Changelog{shas: map[string]bool{}, versions: map[string]bool{}}
}

func (c *Changelog) commit(sha string, message string) bool {
	changelogGiven(sha)
	changelogGiven(message)
	entry := parseCommit(sha, message)
	if entry == nil || c.shas[sha] {
		return false
	}
	c.shas[sha] = true
	c.pending = append(c.pending, *entry)
	return true
}

func (c *Changelog) release(version string) []string {
	changelogGiven(version)
	if c.versions[version] {
		panic("already released")
	}
	if len(c.pending) == 0 {
		panic("nothing to release")
	}
	lines := renderRelease(version, groupEntries(c.pending, c.breakingFirst))
	c.versions[version] = true
	c.pending = nil
	return lines
}

func (c *Changelog) unreleased() int64 {
	return int64(len(c.pending))
}

// The extension round: one more grouping rule, and only the grouper hears about it.
func (c *Changelog) breakingSection(on bool) {
	c.breakingFirst = on
}
