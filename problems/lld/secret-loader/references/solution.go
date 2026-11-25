package main

import "fmt"

// Stands in for the remote vault: each round trip is counted, and a rotation issues the
// next version of a secret.
type vault struct {
	versions map[string]int64
	trips    int64
}

func (v *vault) holds(name string) bool {
	_, ok := v.versions[name]
	return ok
}

func (v *vault) fetch(names []string) map[string]string {
	v.trips++
	out := map[string]string{}
	for _, name := range names {
		out[name] = fmt.Sprintf("%s#%d", name, v.versions[name])
	}
	return out
}

func (v *vault) rotate(name string) {
	v.versions[name]++
}

type SecretLoader struct {
	vault *vault
	// A name is here only between its fetch and its next rotation.
	cache map[string]string
}

func NewSecretLoader(names []string) *SecretLoader {
	versions := map[string]int64{}
	for _, name := range names {
		if name == "" {
			panic("names are not empty")
		}
		if _, seen := versions[name]; seen {
			panic("names are unique")
		}
		versions[name] = 1
	}
	return &SecretLoader{vault: &vault{versions: versions}, cache: map[string]string{}}
}

func (l *SecretLoader) known(name string) {
	if !l.vault.holds(name) {
		panic("unknown secret")
	}
}

func (l *SecretLoader) warm(names []string) {
	for n, secret := range l.vault.fetch(names) {
		l.cache[n] = secret
	}
}

func (l *SecretLoader) reveal(name string) string {
	l.known(name)
	if _, ok := l.cache[name]; !ok {
		l.warm([]string{name})
	}
	return l.cache[name]
}

func (l *SecretLoader) fetches() int64 {
	return l.vault.trips
}

func (l *SecretLoader) rotate(name string) {
	l.known(name)
	l.vault.rotate(name)
	delete(l.cache, name)
}

// The extension round: warm several secrets with one round trip.
func (l *SecretLoader) prefetch(names []string) int64 {
	for _, name := range names {
		l.known(name)
	}
	cold := []string{}
	listed := map[string]bool{}
	for _, name := range names {
		if _, ok := l.cache[name]; !ok && !listed[name] {
			listed[name] = true
			cold = append(cold, name)
		}
	}
	if len(cold) > 0 {
		l.warm(cold)
	}
	return int64(len(cold))
}
