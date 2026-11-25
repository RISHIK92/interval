package main

import (
	"encoding/base64"
	"encoding/hex"
	"strconv"
	"strings"
)

const payloadMaxLayers = 8

// What any layer can be given to encode: non-empty printable ASCII.
func isPayload(text string) bool {
	if text == "" {
		return false
	}
	for i := 0; i < len(text); i++ {
		if text[i] < ' ' || text[i] > '~' {
			return false
		}
	}
	return true
}

type codec interface {
	encode(text string) string
	decode(text string) string
}

// The innermost codec: the text as it is.
type plainCodec struct{}

func (plainCodec) encode(text string) string { return text }
func (plainCodec) decode(text string) string { return text }

// One step a layer adds: wrap, and its inverse, which may panic on input wrap couldn't
// have made.
type step interface {
	wrap(text string) string
	unwrap(text string) string
}

// A decorator: it wraps another codec and adds one step on the outside. Decoding accepts
// only what encoding could have produced: whatever unwrap gives back must be a valid
// payload that wraps to exactly the input again.
type layer struct {
	step
	inner codec
}

func (l layer) encode(text string) string { return l.wrap(l.inner.encode(text)) }

func (l layer) decode(text string) string {
	raw := l.unwrap(text)
	if !isPayload(raw) || l.wrap(raw) != text {
		panic("not something this layer produced")
	}
	return l.inner.decode(raw)
}

type base64Step struct{}

func (base64Step) wrap(text string) string { return base64.StdEncoding.EncodeToString([]byte(text)) }

func (base64Step) unwrap(text string) string {
	raw, err := base64.StdEncoding.DecodeString(text)
	if err != nil {
		panic("not base64")
	}
	return string(raw)
}

type hexStep struct{}

func (hexStep) wrap(text string) string { return hex.EncodeToString([]byte(text)) }

func (hexStep) unwrap(text string) string {
	raw, err := hex.DecodeString(text)
	if err != nil {
		panic("not hex")
	}
	return string(raw)
}

// A length prefix: "<length>:<text>".
type frameStep struct{}

func (frameStep) wrap(text string) string { return strconv.Itoa(len(text)) + ":" + text }

func (frameStep) unwrap(text string) string {
	_, rest, _ := strings.Cut(text, ":")
	return rest
}

// The extension's layer: one check digit, the sum of the character codes mod 10.
type checksumStep struct{}

func (checksumStep) wrap(text string) string {
	sum := 0
	for i := 0; i < len(text); i++ {
		sum += int(text[i])
	}
	return text + strconv.Itoa(sum%10)
}

func (checksumStep) unwrap(text string) string { return text[:len(text)-1] }

var payloadLayers = map[string]step{"base64": base64Step{}, "hex": hexStep{}, "frame": frameStep{}}

type PayloadPipeline struct {
	codec codec
	names []string
}

func NewPayloadPipeline() *PayloadPipeline {
	return &PayloadPipeline{codec: plainCodec{}, names: []string{}}
}

func (p *PayloadPipeline) push(layer string) {
	found, ok := payloadLayers[layer]
	if !ok {
		panic("unknown layer")
	}
	p.add(layer, found)
}

func (p *PayloadPipeline) encode(text string) string {
	if !isPayload(text) {
		panic("not a payload")
	}
	return p.codec.encode(text)
}

func (p *PayloadPipeline) decode(text string) string {
	if !isPayload(text) {
		panic("not a payload")
	}
	return p.codec.decode(text)
}

func (p *PayloadPipeline) layers() []string {
	return append([]string{}, p.names...)
}

// The extension round: a layer that catches corruption.
func (p *PayloadPipeline) checksum() {
	p.add("checksum", checksumStep{})
}

func (p *PayloadPipeline) add(name string, s step) {
	if len(p.names) >= payloadMaxLayers {
		panic("too many layers")
	}
	p.codec = layer{step: s, inner: p.codec}
	p.names = append(p.names, name)
}
