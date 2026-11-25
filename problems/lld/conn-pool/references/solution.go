package main

import (
	"fmt"
	"sync"
)

const maxPoolSize = 1000

// Every method takes the lock, so two goroutines can never take the same idle
// connection or both grow the pool past its maximum.
type ConnPool struct {
	mu  sync.Mutex
	max int64
	// Every connection ever made, including the discarded ones.
	made map[string]bool
	// Most recently released last: reusing from the end keeps the warmest connection
	// busy and lets the coldest ones age out.
	idleConns []string
	held      map[string]string
}

func NewConnPool(maxSize int64) *ConnPool {
	if maxSize < 1 || maxSize > maxPoolSize {
		panic("maxSize is 1 to 1000")
	}
	return &ConnPool{max: maxSize, made: map[string]bool{}, idleConns: []string{}, held: map[string]string{}}
}

func (p *ConnPool) known(conn string) {
	if !p.made[conn] {
		panic("not a connection this pool made")
	}
}

func (p *ConnPool) acquire(client string) *string {
	if client == "" {
		panic("clients are named")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	var conn string
	if n := len(p.idleConns); n > 0 {
		conn = p.idleConns[n-1]
		p.idleConns = p.idleConns[:n-1]
	} else {
		if int64(len(p.held)) >= p.max {
			return nil
		}
		conn = fmt.Sprintf("conn-%d", len(p.made)+1)
		p.made[conn] = true
	}
	p.held[conn] = client
	return &conn
}

func (p *ConnPool) release(conn string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.known(conn)
	if _, ok := p.held[conn]; !ok {
		return false
	}
	delete(p.held, conn)
	p.idleConns = append(p.idleConns, conn)
	return true
}

func (p *ConnPool) invalidate(conn string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.known(conn)
	for i, c := range p.idleConns {
		if c == conn {
			p.idleConns = append(p.idleConns[:i:i], p.idleConns[i+1:]...)
			return true
		}
	}
	_, ok := p.held[conn]
	delete(p.held, conn)
	return ok
}

func (p *ConnPool) created() int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return int64(len(p.made))
}

func (p *ConnPool) idle() int64 {
	p.mu.Lock()
	defer p.mu.Unlock()
	return int64(len(p.idleConns))
}

// The extension round: close the coldest idle connections past a limit.
func (p *ConnPool) shrink(maxIdle int64) int64 {
	if maxIdle < 0 {
		panic("maxIdle is not negative")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	closing := max(int64(len(p.idleConns))-maxIdle, 0)
	p.idleConns = append([]string{}, p.idleConns[closing:]...)
	return closing
}
