package main

type connState string

const (
	connIdle   connState = "idle"
	connOpen   connState = "open"
	connClosed connState = "closed"
	connFailed connState = "failed"
)

type connMove struct {
	action string
	from   connState
}

// Every legal move: (action, from) -> to. Anything else is refused.
var connMoves = map[connMove]connState{
	{"connect", connIdle}:     connOpen,
	{"disconnect", connOpen}:  connClosed,
	{"fail", connIdle}:        connFailed,
	{"fail", connOpen}:        connFailed,
	{"reconnect", connFailed}: connOpen,
}

type Connection struct {
	host     string
	current  connState
	reopened int64
}

func NewConnection(host string) *Connection {
	if host == "" {
		panic("a connection needs a host")
	}
	return &Connection{host: host, current: connIdle}
}

func (c *Connection) move(action string) bool {
	to, ok := connMoves[connMove{action, c.current}]
	if !ok {
		return false
	}
	c.current = to
	return true
}

func (c *Connection) connect() bool {
	return c.move("connect")
}

func (c *Connection) disconnect() bool {
	return c.move("disconnect")
}

func (c *Connection) fail(reason string) {
	if reason == "" {
		panic("a failure needs a reason")
	}
	c.move("fail")
}

func (c *Connection) state() string {
	return string(c.current)
}

// The extension round.
func (c *Connection) reconnect() bool {
	moved := c.move("reconnect")
	if moved {
		c.reopened++
	}
	return moved
}

func (c *Connection) attempts() int64 {
	return c.reopened
}
