package main

import "fmt"

// The columns, in board order: a ticket moves only to a neighbour.
type sprintColumn int

const (
	columnTodo sprintColumn = iota
	columnDoing
	columnReview
	columnDone
)

var columnNames = []string{"todo", "doing", "review", "done"}

type sprintTicket struct {
	id      string
	points  int64
	column  sprintColumn
	blocked bool
	reason  string
}

type SprintBoard struct {
	limit   int64
	tickets []*sprintTicket // in ticket-number order
	byID    map[string]*sprintTicket
}

func NewSprintBoard(wipLimit int64) *SprintBoard {
	if wipLimit < 1 || wipLimit > 100 {
		panic("wipLimit must be within 1-100")
	}
	return &SprintBoard{limit: wipLimit, byID: map[string]*sprintTicket{}}
}

func (b *SprintBoard) find(ticket string) *sprintTicket {
	t, ok := b.byID[ticket]
	if !ok {
		panic("no such ticket")
	}
	return t
}

func (b *SprintBoard) countIn(column sprintColumn) int64 {
	n := int64(0)
	for _, t := range b.tickets {
		if t.column == column {
			n++
		}
	}
	return n
}

func (b *SprintBoard) add(title string, points int64) string {
	if title == "" || points < 1 || points > 100 {
		panic("a ticket needs a title and 1-100 points")
	}
	t := &sprintTicket{id: fmt.Sprintf("T-%d", len(b.tickets)+1), points: points}
	b.tickets = append(b.tickets, t)
	b.byID[t.id] = t
	return t.id
}

func (b *SprintBoard) move(ticket string, column string) bool {
	t := b.find(ticket)
	to := sprintColumn(-1)
	for i, name := range columnNames {
		if name == column {
			to = sprintColumn(i)
		}
	}
	if to < 0 {
		panic("no such column")
	}
	if d := to - t.column; (d != 1 && d != -1) || t.blocked {
		return false
	}
	if to == columnDoing && b.countIn(columnDoing) >= b.limit {
		return false
	}
	t.column = to
	return true
}

func (b *SprintBoard) column(ticket string) string {
	return columnNames[b.find(ticket).column]
}

func (b *SprintBoard) velocity() int64 {
	sum := int64(0)
	for _, t := range b.tickets {
		if t.column == columnDone {
			sum += t.points
		}
	}
	return sum
}

// The extension round.
func (b *SprintBoard) block(ticket string, reason string) {
	t := b.find(ticket)
	if reason == "" {
		panic("a block needs a reason")
	}
	t.blocked, t.reason = true, reason
}

func (b *SprintBoard) unblock(ticket string) {
	b.find(ticket).blocked = false
}

func (b *SprintBoard) blocked() []string {
	out := []string{}
	for _, t := range b.tickets {
		if t.blocked {
			out = append(out, t.id+": "+t.reason)
		}
	}
	return out
}
