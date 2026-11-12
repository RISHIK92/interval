package main

import "sync"

type MeetingRooms struct {
	// Each room's meetings, start -> end.
	rooms []map[int64]int64
	mu    sync.Mutex
}

func NewMeetingRooms(count int64) *MeetingRooms {
	if count < 1 {
		panic("count must be at least 1")
	}
	rooms := make([]map[int64]int64, count)
	for i := range rooms {
		rooms[i] = map[int64]int64{}
	}
	return &MeetingRooms{rooms: rooms}
}

func (m *MeetingRooms) book(start int64, end int64) *int64 {
	if end <= start {
		panic("end must be after start")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for i, meetings := range m.rooms {
		clear := true
		for s, e := range meetings {
			if start < e && s < end {
				clear = false
			}
		}
		if clear {
			meetings[start] = end
			room := int64(i + 1)
			return &room
		}
	}
	return nil
}

func (m *MeetingRooms) cancel(room int64, start int64) bool {
	m.mu.Lock()
	defer m.mu.Unlock()
	if room < 1 || room > int64(len(m.rooms)) {
		return false
	}
	meetings := m.rooms[room-1]
	if _, ok := meetings[start]; !ok {
		return false
	}
	delete(meetings, start)
	return true
}

// The extension round.
func (m *MeetingRooms) extend(room int64, start int64, end int64) bool {
	if end <= start {
		panic("end must be after start")
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if room < 1 || room > int64(len(m.rooms)) {
		return false
	}
	meetings := m.rooms[room-1]
	if _, ok := meetings[start]; !ok {
		return false
	}
	// Against the room's other meetings only: shrinking always fits.
	for s, e := range meetings {
		if s != start && start < e && s < end {
			return false
		}
	}
	meetings[start] = end
	return true
}

func (m *MeetingRooms) free(at int64) int64 {
	m.mu.Lock()
	defer m.mu.Unlock()
	var count int64
	for _, meetings := range m.rooms {
		busy := false
		for s, e := range meetings {
			if s <= at && at < e {
				busy = true
			}
		}
		if !busy {
			count++
		}
	}
	return count
}
