package main

const warehouseMaxQty = 1_000_000_000

type stockOrder struct {
	sku string
	qty int64
}

// On hand = available + reserved, per SKU, after every call: the two maps change
// together and only here.
type Warehouse struct {
	onHand   map[string]int64
	reserved map[string]int64
	open     map[string]stockOrder
	used     map[string]bool
}

func NewWarehouse() *Warehouse {
	return &Warehouse{
		onHand:   map[string]int64{},
		reserved: map[string]int64{},
		open:     map[string]stockOrder{},
		used:     map[string]bool{},
	}
}

func stockNamed(names ...string) {
	for _, n := range names {
		if n == "" {
			panic("skus and order ids are not empty")
		}
	}
}

func stockCounted(qty int64) {
	if qty < 1 || qty > warehouseMaxQty {
		panic("qty must be within 1 and 10^9")
	}
}

func (w *Warehouse) receive(sku string, qty int64) int64 {
	stockNamed(sku)
	stockCounted(qty)
	w.onHand[sku] += qty
	return w.onHand[sku]
}

func (w *Warehouse) reserve(orderId string, sku string, qty int64) bool {
	stockNamed(orderId, sku)
	stockCounted(qty)
	if w.used[orderId] {
		panic("order id already used")
	}
	if qty > w.available(sku) {
		return false
	}
	w.used[orderId] = true
	w.open[orderId] = stockOrder{sku, qty}
	w.reserved[sku] += qty
	return true
}

func (w *Warehouse) close(orderId string) (stockOrder, bool) {
	stockNamed(orderId)
	order, ok := w.open[orderId]
	if ok {
		delete(w.open, orderId)
		w.reserved[order.sku] -= order.qty
	}
	return order, ok
}

func (w *Warehouse) ship(orderId string) bool {
	order, ok := w.close(orderId)
	if ok {
		w.onHand[order.sku] -= order.qty
	}
	return ok
}

func (w *Warehouse) cancel(orderId string) bool {
	_, ok := w.close(orderId)
	return ok
}

func (w *Warehouse) available(sku string) int64 {
	stockNamed(sku)
	return w.onHand[sku] - w.reserved[sku]
}

// The extension round: damaged stock leaves, but only from what's available.
func (w *Warehouse) writeOff(sku string, qty int64) bool {
	stockCounted(qty)
	if qty > w.available(sku) {
		return false
	}
	w.onHand[sku] -= qty
	return true
}
