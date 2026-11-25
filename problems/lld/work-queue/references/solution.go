package main

const maxCapacity = 1_000

// A FIFO queue with stated contracts. Class invariant, true after every call: it holds
// at most capacity items. A ring of capacity slots, so taking is O(1).
type WorkQueue struct {
	slots []string
	head  int
	count int
}

// Precondition: a capacity from 1 to 10^3.
func NewWorkQueue(capacity int64) *WorkQueue {
	if capacity < 1 || capacity > maxCapacity {
		panic("capacity is from 1 to 10^3")
	}
	return &WorkQueue{slots: make([]string, capacity)}
}

// Precondition: a non-empty item. Postcondition: true with the item at the back, or
// false with nothing changed when the queue is full.
func (q *WorkQueue) offer(item string) bool {
	if item == "" {
		panic("an item is not empty")
	}
	if q.count == len(q.slots) {
		return false
	}
	q.slots[(q.head+q.count)%len(q.slots)] = item
	q.count++
	return true
}

// Precondition: the queue isn't empty. Postcondition: the oldest item, removed.
func (q *WorkQueue) take() string {
	if q.count == 0 {
		panic("the queue is empty")
	}
	item := q.slots[q.head]
	q.head = (q.head + 1) % len(q.slots)
	q.count--
	return item
}

// No precondition, and it never changes anything.
func (q *WorkQueue) peekNext() *string {
	if q.count == 0 {
		return nil
	}
	item := q.slots[q.head]
	return &item
}

func (q *WorkQueue) size() int64 {
	return int64(q.count)
}
