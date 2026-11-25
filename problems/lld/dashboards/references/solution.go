package main

import "sort"

// Queries are aggregated: panels hold only a query's name, and a query outlives every
// dashboard. Panels are composed: they live inside their dashboard's map.
type Dashboards struct {
	queries    map[string]string
	dashboards map[string]map[string]string
}

func NewDashboards() *Dashboards {
	return &Dashboards{queries: map[string]string{}, dashboards: map[string]map[string]string{}}
}

func dashNamed(names ...string) {
	for _, n := range names {
		if n == "" {
			panic("names and expressions are not empty")
		}
	}
}

func (d *Dashboards) panels(dashboard string) map[string]string {
	dashNamed(dashboard)
	panels, ok := d.dashboards[dashboard]
	if !ok {
		panic("unknown dashboard")
	}
	return panels
}

func (d *Dashboards) saveQuery(name string, expr string) {
	dashNamed(name, expr)
	if _, ok := d.queries[name]; ok {
		panic("query already saved")
	}
	d.queries[name] = expr
}

func (d *Dashboards) addPanel(dashboard string, panel string, query string) bool {
	dashNamed(dashboard, panel, query)
	if _, ok := d.queries[query]; !ok {
		return false
	}
	if _, taken := d.dashboards[dashboard][panel]; taken {
		return false
	}
	if _, ok := d.dashboards[dashboard]; !ok {
		d.dashboards[dashboard] = map[string]string{}
	}
	d.dashboards[dashboard][panel] = query
	return true
}

func (d *Dashboards) dropDashboard(dashboard string) int64 {
	panels := d.panels(dashboard)
	delete(d.dashboards, dashboard)
	return int64(len(panels))
}

func (d *Dashboards) dropQuery(name string) bool {
	dashNamed(name)
	if _, ok := d.queries[name]; !ok || len(d.usage(name)) > 0 {
		return false
	}
	delete(d.queries, name)
	return true
}

func (d *Dashboards) usage(query string) []string {
	dashNamed(query)
	if _, ok := d.queries[query]; !ok {
		panic("unknown query")
	}
	out := []string{}
	for dashboard, panels := range d.dashboards {
		for panel, used := range panels {
			if used == query {
				out = append(out, dashboard+"/"+panel)
			}
		}
	}
	sort.Strings(out)
	return out
}

// The extension round: a copy owns new panels that share the same queries.
func (d *Dashboards) duplicate(dashboard string, newName string) bool {
	panels := d.panels(dashboard)
	dashNamed(newName)
	if _, ok := d.dashboards[newName]; ok {
		return false
	}
	copied := map[string]string{}
	for panel, query := range panels {
		copied[panel] = query
	}
	d.dashboards[newName] = copied
	return true
}
