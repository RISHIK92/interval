package main

import "strconv"

// A colleague: it knows its own changes and sign-offs, never the other trains.
type releaseTrainCar struct {
	name     string
	hotfix   bool
	changes  []string          // in boarding order
	teams    map[string]string // change -> team
	signed   map[string]bool
	departed bool
}

func (t *releaseTrainCar) needs(role string) bool { return role == "security" || !t.hotfix }

func (t *releaseTrainCar) ready() bool {
	return t.signed["security"] && (t.hotfix || t.signed["qa"])
}

func (t *releaseTrainCar) take(change, team string) {
	t.changes = append(t.changes, change)
	t.teams[change] = team
	t.signed = map[string]bool{}
}

func (t *releaseTrainCar) drop(change string) string {
	for i, c := range t.changes {
		if c == change {
			t.changes = append(t.changes[:i:i], t.changes[i+1:]...)
			break
		}
	}
	team := t.teams[change]
	delete(t.teams, change)
	t.signed = map[string]bool{}
	return team
}

// The mediator: teams, reviewers and trains only talk to it, and it keeps the rule that
// any change to a train's contents voids its sign-offs.
type ReleaseTrain struct {
	trains   []*releaseTrainCar
	aboard   map[string]*releaseTrainCar
	departed map[string]bool
}

func NewReleaseTrain() *ReleaseTrain {
	return &ReleaseTrain{aboard: map[string]*releaseTrainCar{}, departed: map[string]bool{}}
}

func (r *ReleaseTrain) board(team string, change string) string {
	if team == "" || change == "" {
		panic("empty name")
	}
	if _, ok := r.aboard[change]; ok || r.departed[change] {
		panic("the change has boarded")
	}
	var train *releaseTrainCar
	for _, t := range r.trains {
		if !t.departed && !t.hotfix && !t.ready() {
			train = t
			break
		}
	}
	if train == nil {
		train = r.newTrain(false)
	}
	train.take(change, team)
	r.aboard[change] = train
	return train.name
}

func (r *ReleaseTrain) signOff(role string, train string) bool {
	if role != "qa" && role != "security" {
		panic("unknown role")
	}
	t := r.find(train)
	if t.departed || len(t.changes) == 0 || !t.needs(role) || t.signed[role] {
		return false
	}
	t.signed[role] = true
	return true
}

func (r *ReleaseTrain) pull(change string) bool {
	if change == "" {
		panic("empty change")
	}
	train, ok := r.aboard[change]
	if !ok {
		return false
	}
	train.drop(change)
	delete(r.aboard, change)
	return true
}

func (r *ReleaseTrain) depart(train string) []string {
	t := r.find(train)
	if t.departed || !t.ready() {
		return []string{}
	}
	t.departed = true
	out := []string{}
	for _, change := range t.changes {
		delete(r.aboard, change)
		r.departed[change] = true
		out = append(out, t.teams[change]+":"+change)
	}
	return out
}

// The extension round: a hotfix leaves its train and departs alone.
func (r *ReleaseTrain) hotfix(change string) string {
	train, ok := r.aboard[change]
	if !ok || train.hotfix {
		panic("not aboard a regular train")
	}
	alone := r.newTrain(true)
	alone.take(change, train.drop(change))
	r.aboard[change] = alone
	return alone.name
}

func (r *ReleaseTrain) newTrain(hotfix bool) *releaseTrainCar {
	t := &releaseTrainCar{
		name:   "T" + strconv.Itoa(len(r.trains)+1),
		hotfix: hotfix,
		teams:  map[string]string{},
		signed: map[string]bool{},
	}
	r.trains = append(r.trains, t)
	return t
}

func (r *ReleaseTrain) find(name string) *releaseTrainCar {
	for _, t := range r.trains {
		if t.name == name {
			return t
		}
	}
	panic("unknown train")
}
