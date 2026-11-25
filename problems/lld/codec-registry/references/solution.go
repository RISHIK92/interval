package main

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const codecToken = "[a-z0-9][a-z0-9.+-]*"

var (
	codecContentType = regexp.MustCompile(`^` + codecToken + `/` + codecToken + `$`)
	codecMediaRange  = regexp.MustCompile(`^(?:\*/\*|` + codecToken + `/\*|` + codecToken + `/` + codecToken + `)$`)
	codecQuality     = regexp.MustCompile(`^(?:0(?:\.[0-9]{0,3})?|1(?:\.0{0,3})?)$`)
)

const codecUnreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"

type codecField struct{ name, value string }

// What the registry needs from a codec: turn a flat record into text. Fields arrive
// sorted by name, so every codec writes them in the same order.
type codec interface {
	encode(fields []codecField) string
}

type jsonCodec struct{}

func (jsonCodec) encode(fields []codecField) string {
	quoted := func(text string) string {
		return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(text) + `"`
	}
	parts := []string{}
	for _, f := range fields {
		parts = append(parts, quoted(f.name)+":"+quoted(f.value))
	}
	return "{" + strings.Join(parts, ",") + "}"
}

type formCodec struct{}

func (formCodec) encode(fields []codecField) string {
	escaped := func(text string) string {
		var out strings.Builder
		for i := 0; i < len(text); i++ {
			if strings.IndexByte(codecUnreserved, text[i]) >= 0 {
				out.WriteByte(text[i])
			} else {
				fmt.Fprintf(&out, "%%%02X", text[i])
			}
		}
		return out.String()
	}
	parts := []string{}
	for _, f := range fields {
		parts = append(parts, escaped(f.name)+"="+escaped(f.value))
	}
	return strings.Join(parts, "&")
}

type csvCodec struct{}

func (csvCodec) encode(fields []codecField) string {
	cell := func(text string) string {
		if strings.ContainsAny(text, `,"`) {
			return `"` + strings.ReplaceAll(text, `"`, `""`) + `"`
		}
		return text
	}
	header, values := []string{}, []string{}
	for _, f := range fields {
		header = append(header, cell(f.name))
		values = append(values, cell(f.value))
	}
	return strings.Join(header, ",") + "\n" + strings.Join(values, ",")
}

// The factory method's table: a codec's name makes its codec, and nothing else in the
// registry knows the concrete types. A new format is a type and a line here.
var codecMakers = map[string]func() codec{
	"json": func() codec { return jsonCodec{} },
	"form": func() codec { return formCodec{} },
	"csv":  func() codec { return csvCodec{} },
}

func makeCodec(name string) codec {
	made, ok := codecMakers[name]
	if !ok {
		panic("unknown codec")
	}
	return made()
}

// A q-value in thousandths, so no float is ever compared.
func codecQualityOf(text string) int64 {
	if !codecQuality.MatchString(text) {
		panic("bad q-value")
	}
	whole, fraction, _ := strings.Cut(text, ".")
	w, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		panic(err)
	}
	f, err := strconv.ParseInt((fraction + "000")[:3], 10, 64)
	if err != nil {
		panic(err)
	}
	return w*1000 + f
}

func codecRanges(accept string) map[string]int64 {
	ranges := map[string]int64{}
	for _, item := range strings.Split(accept, ",") {
		parts := strings.Split(item, ";")
		for i := range parts {
			parts[i] = strings.Trim(parts[i], " ")
		}
		media := parts[0]
		if _, seen := ranges[media]; !codecMediaRange.MatchString(media) || seen || len(parts) > 2 {
			panic("bad media range")
		}
		q := int64(1000)
		if len(parts) == 2 {
			if !strings.HasPrefix(parts[1], "q=") {
				panic("only q is allowed")
			}
			q = codecQualityOf(parts[1][2:])
		}
		ranges[media] = q
	}
	return ranges
}

type CodecRegistry struct {
	codecs   map[string]codec
	order    []string // content types in the order they were added
	fallback *string
}

func NewCodecRegistry() *CodecRegistry {
	return &CodecRegistry{codecs: map[string]codec{}}
}

func (r *CodecRegistry) add(contentType string, name string) {
	if !codecContentType.MatchString(contentType) {
		panic("bad content type")
	}
	if _, ok := r.codecs[contentType]; ok {
		panic("already added")
	}
	r.codecs[contentType] = makeCodec(name)
	r.order = append(r.order, contentType)
}

func (r *CodecRegistry) negotiate(accept string) *string {
	ranges := codecRanges(accept)
	var best *string
	bestQuality := int64(0)
	for _, contentType := range r.order {
		// The most specific range that matches decides, even when it says q=0.
		top, _, _ := strings.Cut(contentType, "/")
		q := int64(0)
		for _, candidate := range []string{contentType, top + "/*", "*/*"} {
			if found, ok := ranges[candidate]; ok {
				q = found
				break
			}
		}
		if q > bestQuality {
			chosen := contentType
			best, bestQuality = &chosen, q
		}
	}
	if best == nil {
		return r.fallback
	}
	return best
}

func (r *CodecRegistry) encodeWith(contentType string, fields map[string]string) string {
	found, ok := r.codecs[contentType]
	if !ok {
		panic("no codec for that type")
	}
	if len(fields) == 0 {
		panic("empty record")
	}
	sorted := []codecField{}
	for name, value := range fields {
		if name == "" || value == "" {
			panic("empty name or value")
		}
		sorted = append(sorted, codecField{name, value})
	}
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].name < sorted[j].name })
	return found.encode(sorted)
}

// The extension round: a type to answer with when nothing is acceptable.
func (r *CodecRegistry) fallbackType(contentType string) {
	if _, ok := r.codecs[contentType]; !ok {
		panic("no codec for that type")
	}
	chosen := contentType
	r.fallback = &chosen
}
