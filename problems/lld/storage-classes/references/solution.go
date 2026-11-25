package main

// Fees charged and restores made so far, by reads and (in the extension) moves.
type storageMeter struct{ fees, restores int64 }

type storedObject struct {
	data         string
	storageClass storageClass
	restored     bool
}

// Every class keeps the same promise: read hands back exactly what was stored. They differ
// only in what that costs, so the bucket never asks which class an object is in.
type storageClass interface {
	rate() int64
	read(stored *storedObject, meter *storageMeter) string
	leave(stored *storedObject, meter *storageMeter)
}

type standardClass struct{}

func (standardClass) rate() int64                                       { return 4 }
func (standardClass) read(stored *storedObject, _ *storageMeter) string { return stored.data }
func (standardClass) leave(*storedObject, *storageMeter)                {}

type infrequentAccessClass struct{}

func (infrequentAccessClass) rate() int64 { return 2 }
func (infrequentAccessClass) read(stored *storedObject, meter *storageMeter) string {
	meter.fees += int64(len(stored.data))
	return stored.data
}
func (infrequentAccessClass) leave(*storedObject, *storageMeter) {}

// Slow to reach, never absent: the first read restores the object, and pays for it,
// instead of failing or answering null.
type archiveClass struct{}

func (archiveClass) rate() int64 { return 1 }
func (a archiveClass) read(stored *storedObject, meter *storageMeter) string {
	a.leave(stored, meter)
	return stored.data
}
func (archiveClass) leave(stored *storedObject, meter *storageMeter) {
	if stored.restored {
		return
	}
	meter.restores++
	meter.fees += 3 * int64(len(stored.data))
	stored.restored = true
}

var storageClasses = map[string]storageClass{
	"standard":          standardClass{},
	"infrequent-access": infrequentAccessClass{},
	"archive":           archiveClass{},
}

func storageKey(key string) {
	if key == "" {
		panic("empty key")
	}
}

func storageClassNamed(name string) storageClass {
	found, ok := storageClasses[name]
	if !ok {
		panic("unknown storage class")
	}
	return found
}

type StorageBucket struct {
	objects map[string]*storedObject
	meter   storageMeter
}

func NewStorageBucket() *StorageBucket {
	return &StorageBucket{objects: map[string]*storedObject{}}
}

func (b *StorageBucket) store(key string, data string, storageClass string) {
	storageKey(key)
	b.objects[key] = &storedObject{data: data, storageClass: storageClassNamed(storageClass)}
}

func (b *StorageBucket) read(key string) *string {
	storageKey(key)
	stored, ok := b.objects[key]
	if !ok {
		return nil
	}
	data := stored.storageClass.read(stored, &b.meter)
	return &data
}

func (b *StorageBucket) restores() int64 {
	return b.meter.restores
}

func (b *StorageBucket) monthlyCost() int64 {
	keeping := int64(0)
	for _, s := range b.objects {
		keeping += s.storageClass.rate() * int64(len(s.data))
	}
	return keeping + b.meter.fees
}

// The extension round: a lifecycle move, which each class leaves in its own way.
func (b *StorageBucket) transition(key string, storageClass string) bool {
	storageKey(key)
	target := storageClassNamed(storageClass)
	stored, ok := b.objects[key]
	if !ok || stored.storageClass == target {
		return false
	}
	stored.storageClass.leave(stored, &b.meter)
	b.objects[key] = &storedObject{data: stored.data, storageClass: target}
	return true
}
