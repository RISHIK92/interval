package main

import (
	"strings"
	"sync"
)

// The one loaded copy of the settings. Only the holder creates it, and only when
// something first needs a setting.
type settings struct{ entries map[string]string }

func filled(text string) {
	if text == "" {
		panic("keys and values are not empty")
	}
}

type SettingsHolder struct {
	mu        sync.Mutex
	source    map[string]string
	overrides map[string]string
	settings  *settings
	loadCount int64
}

func NewSettingsHolder(defaults map[string]string) *SettingsHolder {
	source := map[string]string{}
	for key, value := range defaults {
		filled(key)
		filled(value)
		source[key] = value
	}
	return &SettingsHolder{source: source, overrides: map[string]string{}}
}

// Every reader goes through here; the lock makes "load once" hold even when many
// goroutines ask for their first setting together. The caller holds mu.
func (h *SettingsHolder) instance() *settings {
	if h.settings == nil {
		entries := map[string]string{}
		for k, v := range h.source {
			entries[k] = v
		}
		h.settings = &settings{entries}
		h.loadCount++
	}
	return h.settings
}

func (h *SettingsHolder) value(key string) *string {
	filled(key)
	h.mu.Lock()
	defer h.mu.Unlock()
	loaded := h.instance().entries
	if v, ok := h.overrides[key]; ok {
		return &v
	}
	if v, ok := loaded[key]; ok {
		return &v
	}
	return nil
}

func (h *SettingsHolder) loads() int64 {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.loadCount
}

func (h *SettingsHolder) overrideKey(key string, value string) {
	filled(key)
	filled(value)
	h.mu.Lock()
	defer h.mu.Unlock()
	h.overrides[key] = value
}

func (h *SettingsHolder) reload() {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.settings = nil
	h.overrides = map[string]string{}
}

// The extension round: a view of one prefix, read through the same single instance.
func (h *SettingsHolder) scoped(prefix string) map[string]string {
	filled(prefix)
	h.mu.Lock()
	defer h.mu.Unlock()
	out := map[string]string{}
	for k, v := range h.instance().entries {
		if strings.HasPrefix(k, prefix) {
			out[k] = v
		}
	}
	for k, v := range h.overrides {
		if strings.HasPrefix(k, prefix) {
			out[k] = v
		}
	}
	return out
}
