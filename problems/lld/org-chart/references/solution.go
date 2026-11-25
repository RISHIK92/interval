package main

// Each person knows their manager, and each manager knows their direct reports; the two
// sides change together. The root is the one person with no manager ("" here).
type OrgChart struct {
	root    string
	manager map[string]string
	reports map[string]map[string]bool
}

func orgNamed(names ...string) {
	for _, n := range names {
		if n == "" {
			panic("names are not empty")
		}
	}
}

func NewOrgChart(ceo string) *OrgChart {
	orgNamed(ceo)
	return &OrgChart{
		root:    ceo,
		manager: map[string]string{ceo: ""},
		reports: map[string]map[string]bool{ceo: {}},
	}
}

func (o *OrgChart) link(name, manager string) {
	o.manager[name] = manager
	if manager != "" {
		o.reports[manager][name] = true
	}
}

func (o *OrgChart) unlink(name string) {
	if manager := o.manager[name]; manager != "" {
		delete(o.reports[manager], name)
	}
}

func (o *OrgChart) known(name string) bool {
	_, ok := o.manager[name]
	return ok
}

func (o *OrgChart) hire(name string, manager string) bool {
	orgNamed(name, manager)
	if o.known(name) || !o.known(manager) {
		return false
	}
	o.reports[name] = map[string]bool{}
	o.link(name, manager)
	return true
}

func (o *OrgChart) reassign(name string, manager string) bool {
	orgNamed(name, manager)
	if !o.known(name) || !o.known(manager) || name == o.root {
		return false
	}
	for _, up := range o.chain(manager) {
		if up == name {
			return false
		}
	}
	o.unlink(name)
	o.link(name, manager)
	return true
}

func (o *OrgChart) leave(name string) bool {
	orgNamed(name)
	if !o.known(name) || name == o.root {
		return false
	}
	up := o.manager[name]
	o.unlink(name)
	mine := o.reports[name]
	delete(o.reports, name)
	for report := range mine {
		o.link(report, up)
	}
	delete(o.manager, name)
	return true
}

func (o *OrgChart) chain(name string) []string {
	orgNamed(name)
	if !o.known(name) {
		panic("unknown person")
	}
	out := []string{}
	for at := name; at != ""; at = o.manager[at] {
		out = append(out, at)
	}
	return out
}

func (o *OrgChart) span(manager string) int64 {
	orgNamed(manager)
	reports, ok := o.reports[manager]
	if !ok {
		panic("unknown person")
	}
	return int64(len(reports))
}

// The extension round: a person swaps places with their manager.
func (o *OrgChart) promote(name string) bool {
	orgNamed(name)
	if !o.known(name) || name == o.root {
		return false
	}
	boss := o.manager[name]
	above := o.manager[boss]
	theirs := o.reports[boss]
	mine := o.reports[name]
	o.unlink(boss)
	o.link(name, above)
	o.reports[name] = map[string]bool{}
	o.reports[boss] = map[string]bool{}
	o.link(boss, name)
	for report := range theirs {
		if report != name {
			o.link(report, name)
		}
	}
	for report := range mine {
		o.link(report, boss)
	}
	if boss == o.root {
		o.root = name
	}
	return true
}
