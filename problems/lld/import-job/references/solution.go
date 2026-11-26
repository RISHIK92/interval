package main

import (
	"strconv"
	"strings"
)

const importFields = 3
const maxAge = 150
const maxSeconds = 1000000000
const msPerSecond = 1000

var eventTypes = map[string]bool{"click": true, "view": true, "buy": true}

// A whole number written without leading zeros, at most `most`; false otherwise.
func whole(text string, most int64) bool {
	if text == "" || len(text) > 10 || (len(text) > 1 && text[0] == '0') {
		return false
	}
	for _, c := range text {
		if c < '0' || c > '9' {
			return false
		}
	}
	n, _ := strconv.ParseInt(text, 10, 64)
	return n <= most
}

// The steps that differ by kind.
type importKind interface {
	validate(fields []string) string // "" when valid
	transform(fields []string) string
	key(fields []string) string
}

// The template method: run fixes the skeleton (extract, validate, transform, optionally
// dedupe, load) and each kind fills in only the steps that differ.
type importer struct {
	kind    importKind
	loaded  []string
	rejects []string
	keys    map[string]bool
	runs    int64
}

func (im *importer) run(lines []string, dedupe bool) map[string]int64 {
	for _, line := range lines {
		if line == "" {
			panic("an empty line")
		}
	}
	im.runs++
	counts := map[string]int64{"read": int64(len(lines)), "loaded": 0, "rejected": 0}
	if dedupe {
		counts["duplicates"] = 0
	}
	for i, line := range lines {
		fields := strings.Split(line, ",")
		reason := "fields"
		if len(fields) == importFields {
			reason = im.kind.validate(fields)
		}
		if reason != "" {
			im.rejects = append(im.rejects, strconv.FormatInt(im.runs, 10)+":"+strconv.Itoa(i+1)+" "+reason)
			counts["rejected"]++
			continue
		}
		key := im.kind.key(fields)
		if dedupe && im.keys[key] {
			counts["duplicates"]++
			continue
		}
		im.keys[key] = true
		im.loaded = append(im.loaded, im.kind.transform(fields))
		counts["loaded"]++
	}
	return counts
}

// email,name,age
type userImport struct{}

func (userImport) validate(fields []string) string {
	local, domain, found := strings.Cut(fields[0], "@")
	if !found || local == "" || domain == "" || strings.Contains(domain, "@") {
		return "email"
	}
	if fields[1] == "" {
		return "name"
	}
	if !whole(fields[2], maxAge) {
		return "age"
	}
	return ""
}

func (userImport) transform(fields []string) string {
	return "user:" + strings.ToLower(fields[0]) + ":" + fields[1] + ":" + fields[2]
}

func (userImport) key(fields []string) string { return strings.ToLower(fields[0]) }

// ts,type,user, with ts in seconds
type eventImport struct{}

func (eventImport) validate(fields []string) string {
	if !whole(fields[0], maxSeconds) {
		return "ts"
	}
	if !eventTypes[fields[1]] {
		return "type"
	}
	if fields[2] == "" {
		return "user"
	}
	return ""
}

func (eventImport) transform(fields []string) string {
	seconds, _ := strconv.ParseInt(fields[0], 10, 64)
	return "event:" + strconv.FormatInt(seconds*msPerSecond, 10) + ":" + fields[1] + ":" + fields[2]
}

func (e eventImport) key(fields []string) string { return e.transform(fields) }

type ImportJob struct {
	importer *importer
	deduping bool
}

func NewImportJob(kind string) *ImportJob {
	var steps importKind
	switch kind {
	case "users":
		steps = userImport{}
	case "events":
		steps = eventImport{}
	default:
		panic("unknown kind")
	}
	return &ImportJob{importer: &importer{kind: steps, keys: map[string]bool{}}}
}

func (j *ImportJob) runImport(lines []string) map[string]int64 {
	return j.importer.run(lines, j.deduping)
}

func (j *ImportJob) loaded() []string {
	return append([]string{}, j.importer.loaded...)
}

func (j *ImportJob) rejects() []string {
	return append([]string{}, j.importer.rejects...)
}

// The extension round: the skeleton's optional step, switched on or off.
func (j *ImportJob) dedupe(on bool) {
	j.deduping = on
}
