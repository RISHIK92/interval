package main

// Which actions each role may take: the one table a new role is added to.
var adminRoles = map[string]map[string]bool{
	"viewer":   {"read": true},
	"operator": {"read": true, "suspend": true, "restore": true},
	"admin":    {"read": true, "suspend": true, "restore": true, "delete": true},
}

var adminActions = map[string]bool{"read": true, "suspend": true, "restore": true, "delete": true}

func adminGiven(value string) {
	if value == "" {
		panic("empty")
	}
}

// What callers see: the real API and its proxy answer the same call.
type adminAPI interface {
	handle(user, action, target string) string
}

// The real subject. It does whatever it's asked and knows nothing about roles.
type realAdminAPI struct {
	calls     int64
	suspended map[string]bool
	deleted   map[string]bool
}

func (a *realAdminAPI) handle(user, action, target string) string {
	a.calls++
	if a.deleted[target] {
		return "404"
	}
	switch action {
	case "suspend":
		if a.suspended[target] {
			return "409"
		}
		a.suspended[target] = true
	case "restore":
		if !a.suspended[target] {
			return "409"
		}
		delete(a.suspended, target)
	case "delete":
		a.deleted[target] = true
	}
	return "200"
}

// A protection proxy: the same call as the real API, but it decides first whether the
// call may go through, and writes every attempt down. A call it stops never reaches the
// real API, which the API's own call count shows.
type AdminProxy struct {
	api   *realAdminAPI
	roles map[string]map[string]bool
	log   []string
	glass map[string]bool
}

var _ adminAPI = (*AdminProxy)(nil)

func NewAdminProxy() *AdminProxy {
	return &AdminProxy{
		api:   &realAdminAPI{suspended: map[string]bool{}, deleted: map[string]bool{}},
		roles: map[string]map[string]bool{},
		log:   []string{},
		glass: map[string]bool{},
	}
}

func (p *AdminProxy) grant(user string, role string) {
	adminGiven(user)
	if _, ok := adminRoles[role]; !ok {
		panic("unknown role")
	}
	if p.roles[user] == nil {
		p.roles[user] = map[string]bool{}
	}
	p.roles[user][role] = true
}

func (p *AdminProxy) handle(user, action, target string) string {
	// Who you are (authentication) comes before what you may do (authorization).
	held, ok := p.roles[user]
	if !ok {
		return "401"
	}
	allowed := p.glass[user]
	for role := range held {
		allowed = allowed || adminRoles[role][action]
	}
	if !allowed {
		return "403"
	}
	return p.api.handle(user, action, target)
}

func (p *AdminProxy) invoke(user string, action string, target string) string {
	adminGiven(user)
	if !adminActions[action] {
		panic("unknown action")
	}
	adminGiven(target)
	status := p.handle(user, action, target)
	line := user + " " + action + " " + target + " " + status
	if p.glass[user] {
		line += " break-glass"
	}
	p.log = append(p.log, line)
	return status + " " + action + " " + target
}

func (p *AdminProxy) audit() []string {
	return append([]string{}, p.log...)
}

func (p *AdminProxy) realCalls() int64 {
	return p.api.calls
}

// The extension round: emergency access, marked in the audit.
func (p *AdminProxy) breakGlass(user string) bool {
	p.known(user)
	if p.glass[user] {
		return false
	}
	p.glass[user] = true
	return true
}

func (p *AdminProxy) endBreakGlass(user string) bool {
	p.known(user)
	if !p.glass[user] {
		return false
	}
	delete(p.glass, user)
	return true
}

func (p *AdminProxy) known(user string) {
	if _, ok := p.roles[user]; !ok {
		panic("break-glass is for users with a grant")
	}
}
