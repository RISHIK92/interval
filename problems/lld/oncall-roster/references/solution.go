package main

import "sort"

// Teams aggregate engineers: a team holds its members' names in join order, and each
// engineer knows their teams. Disbanding drops only the team's side and the links.
type OncallRoster struct {
	teamsByName map[string]map[string]bool
	members     map[string][]string
	lastOnCall  map[string]int
}

func NewOncallRoster() *OncallRoster {
	return &OncallRoster{
		teamsByName: map[string]map[string]bool{},
		members:     map[string][]string{},
		lastOnCall:  map[string]int{},
	}
}

func rosterNamed(names ...string) {
	for _, n := range names {
		if n == "" {
			panic("names are not empty")
		}
	}
}

func (r *OncallRoster) addEngineer(name string) {
	rosterNamed(name)
	if _, ok := r.teamsByName[name]; ok {
		panic("engineer already on the roster")
	}
	r.teamsByName[name] = map[string]bool{}
}

func (r *OncallRoster) addTeam(team string) {
	rosterNamed(team)
	if _, ok := r.members[team]; ok {
		panic("team already exists")
	}
	r.members[team] = []string{}
}

func (r *OncallRoster) join(team string, name string) bool {
	rosterNamed(team, name)
	members, okTeam := r.members[team]
	teams, okName := r.teamsByName[name]
	if !okTeam || !okName {
		panic("unknown team or engineer")
	}
	if teams[team] {
		return false
	}
	r.members[team] = append(members, name)
	teams[team] = true
	return true
}

func (r *OncallRoster) disband(team string) bool {
	rosterNamed(team)
	members, ok := r.members[team]
	if !ok {
		return false
	}
	for _, name := range members {
		delete(r.teamsByName[name], team)
	}
	delete(r.members, team)
	delete(r.lastOnCall, team)
	return true
}

func (r *OncallRoster) teamsOf(name string) []string {
	rosterNamed(name)
	teams, ok := r.teamsByName[name]
	if !ok {
		panic("unknown engineer")
	}
	out := []string{}
	for t := range teams {
		out = append(out, t)
	}
	sort.Strings(out)
	return out
}

// The extension round: the next on call, in join order.
func (r *OncallRoster) rotate(team string) string {
	rosterNamed(team)
	members := r.members[team]
	if len(members) == 0 {
		panic("unknown team or no members")
	}
	last, ok := r.lastOnCall[team]
	if !ok {
		last = -1
	}
	next := (last + 1) % len(members)
	r.lastOnCall[team] = next
	return members[next]
}
