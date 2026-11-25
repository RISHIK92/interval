package main

import "strconv"

const maxSizeGb = 65_536

var volumeOps = map[string]bool{"snapshot": true, "resize": true, "encrypt": true}

type volumeSnapshot struct {
	id   string
	size int64
}

type storageVolume struct {
	name string
	size int64
	// Each snapshot id and the size it recorded, oldest first.
	snapshots []volumeSnapshot
}

// Each operation is its own narrow capability. A driver holds only the ones it has, so the
// manager can't call an operation a driver lacks: it finds no capability and fails.
type snapshotter interface {
	take(volume *storageVolume) string
	restore(volume *storageVolume, snapshot string) bool
}

type resizer interface {
	grow(volume *storageVolume, size int64) bool
}

type keptSnapshots struct{}

func (keptSnapshots) take(volume *storageVolume) string {
	id := volume.name + "@" + strconv.Itoa(len(volume.snapshots)+1)
	volume.snapshots = append(volume.snapshots, volumeSnapshot{id, volume.size})
	return id
}

func (keptSnapshots) restore(volume *storageVolume, snapshot string) bool {
	for _, s := range volume.snapshots {
		if s.id == snapshot {
			volume.size = s.size
			return true
		}
	}
	return false
}

type growOnly struct{}

func (growOnly) grow(volume *storageVolume, size int64) bool {
	if size <= volume.size {
		return false
	}
	volume.size = size
	return true
}

// "encrypt" is a known operation, but no call here needs it, so it has no capability yet.
type storageDriver struct {
	snapshots snapshotter
	resizing  resizer
}

func newStorageDriver(ops []string) *storageDriver {
	seen := map[string]bool{}
	for _, op := range ops {
		if seen[op] || !volumeOps[op] {
			panic("ops are distinct, from snapshot, resize and encrypt")
		}
		seen[op] = true
	}
	driver := &storageDriver{}
	if seen["snapshot"] {
		driver.snapshots = keptSnapshots{}
	}
	if seen["resize"] {
		driver.resizing = growOnly{}
	}
	return driver
}

func volumeNamed(text string) string {
	if text == "" {
		panic("an empty name")
	}
	return text
}

func volumeSized(sizeGb int64) int64 {
	if sizeGb < 1 || sizeGb > maxSizeGb {
		panic("a size is 1 to 65536 GB")
	}
	return sizeGb
}

type volumeEntry struct {
	volume *storageVolume
	driver *storageDriver
}

type VolumeManager struct {
	drivers map[string]*storageDriver
	volumes map[string]volumeEntry
}

func NewVolumeManager() *VolumeManager {
	return &VolumeManager{map[string]*storageDriver{}, map[string]volumeEntry{}}
}

func (m *VolumeManager) driver(name string, ops []string) {
	if _, taken := m.drivers[volumeNamed(name)]; taken {
		panic("a driver is registered once")
	}
	m.drivers[name] = newStorageDriver(ops)
}

func (m *VolumeManager) create(volume string, driver string, sizeGb int64) bool {
	volumeNamed(volume)
	found, ok := m.drivers[driver]
	if !ok {
		panic("an unknown driver")
	}
	size := volumeSized(sizeGb)
	if _, taken := m.volumes[volume]; taken {
		return false
	}
	m.volumes[volume] = volumeEntry{&storageVolume{name: volume, size: size}, found}
	return true
}

func (m *VolumeManager) snapshot(volume string) string {
	entry, snapshots := m.snapshotting(volume)
	return snapshots.take(entry.volume)
}

func (m *VolumeManager) resize(volume string, sizeGb int64) bool {
	entry := m.find(volume)
	if entry.driver.resizing == nil {
		panic("the driver can't resize")
	}
	return entry.driver.resizing.grow(entry.volume, volumeSized(sizeGb))
}

func (m *VolumeManager) snapshots(volume string) []string {
	entry, _ := m.snapshotting(volume)
	out := []string{}
	for _, s := range entry.volume.snapshots {
		out = append(out, s.id)
	}
	return out
}

// The extension round.
func (m *VolumeManager) restore(volume string, snapshot string) bool {
	entry, snapshots := m.snapshotting(volume)
	return snapshots.restore(entry.volume, volumeNamed(snapshot))
}

func (m *VolumeManager) find(volume string) volumeEntry {
	entry, ok := m.volumes[volume]
	if !ok {
		panic("an unknown volume")
	}
	return entry
}

func (m *VolumeManager) snapshotting(volume string) (volumeEntry, snapshotter) {
	entry := m.find(volume)
	if entry.driver.snapshots == nil {
		panic("the driver can't snapshot")
	}
	return entry, entry.driver.snapshots
}
