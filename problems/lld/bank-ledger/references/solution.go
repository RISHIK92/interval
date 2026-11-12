package main

import "sync"

type Bank struct {
	accounts map[string]int64
	// One lock for the whole ledger: a transfer touches two accounts at once, and a lock
	// per account would need an ordering to avoid deadlock.
	mu sync.Mutex
}

func NewBank() *Bank {
	return &Bank{accounts: map[string]int64{}}
}

func positive(amount int64) {
	if amount <= 0 {
		panic("amount must be positive")
	}
}

func (b *Bank) get(account string) int64 {
	balance, ok := b.accounts[account]
	if !ok {
		panic("unknown account")
	}
	return balance
}

func (b *Bank) open(account string, balance int64) {
	if balance < 0 {
		panic("negative opening balance")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if _, ok := b.accounts[account]; ok {
		panic("account exists")
	}
	b.accounts[account] = balance
}

func (b *Bank) deposit(account string, amount int64) int64 {
	positive(amount)
	b.mu.Lock()
	defer b.mu.Unlock()
	balance := b.get(account) + amount
	b.accounts[account] = balance
	return balance
}

func (b *Bank) withdraw(account string, amount int64) bool {
	positive(amount)
	b.mu.Lock()
	defer b.mu.Unlock()
	balance := b.get(account)
	if balance < amount {
		return false
	}
	b.accounts[account] = balance - amount
	return true
}

func (b *Bank) transfer(source string, target string, amount int64) bool {
	positive(amount)
	if source == target {
		panic("a transfer needs two accounts")
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	from, to := b.get(source), b.get(target)
	if from < amount {
		return false
	}
	b.accounts[source] = from - amount
	b.accounts[target] = to + amount
	return true
}

func (b *Bank) balance(account string) int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.get(account)
}

func (b *Bank) total() int64 {
	b.mu.Lock()
	defer b.mu.Unlock()
	var sum int64
	for _, v := range b.accounts {
		sum += v
	}
	return sum
}
