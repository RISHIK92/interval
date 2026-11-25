package main

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var requestMethods = map[string]bool{
	"GET": true, "HEAD": true, "POST": true, "PUT": true, "PATCH": true, "DELETE": true, "OPTIONS": true,
}
var requestURL = regexp.MustCompile(`^https?://[^?# ]+$`)
var headerToken = regexp.MustCompile(`^[A-Za-z0-9-]+$`)

func filled(text string) {
	if text == "" {
		panic("not empty")
	}
}

func canonical(name string) string {
	if !headerToken.MatchString(name) {
		panic("a header name is letters, digits and dashes")
	}
	parts := strings.Split(name, "-")
	for i, part := range parts {
		if part != "" {
			parts[i] = strings.ToUpper(part[:1]) + strings.ToLower(part[1:])
		}
	}
	return strings.Join(parts, "-")
}

func unreserved(c byte) bool {
	return c >= 'A' && c <= 'Z' || c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || strings.IndexByte("-._~", c) >= 0
}

func encode(text string) string {
	var out strings.Builder
	for i := 0; i < len(text); i++ {
		if unreserved(text[i]) {
			out.WriteByte(text[i])
		} else {
			fmt.Fprintf(&out, "%%%02X", text[i])
		}
	}
	return out.String()
}

type RequestBuilder struct {
	method  string
	url     string
	headers map[string]string
	pairs   []string
	text    *string
	// What build produced; only copies leave, so nothing can change a built request.
	built []string
}

func NewRequestBuilder(method string, url string) *RequestBuilder {
	if !requestMethods[method] {
		panic("unknown method")
	}
	if !requestURL.MatchString(url) {
		panic("bad url")
	}
	return &RequestBuilder{method: method, url: url, headers: map[string]string{}, pairs: []string{}}
}

func (b *RequestBuilder) open() {
	if b.built != nil {
		panic("the request is built")
	}
}

func (b *RequestBuilder) header(name string, value string) {
	b.open()
	key := canonical(name)
	if key == "Content-Length" {
		panic("the length is set automatically")
	}
	trimmed := strings.Trim(value, " ")
	filled(trimmed)
	b.headers[key] = trimmed
}

func (b *RequestBuilder) query(key string, value string) {
	b.open()
	filled(key)
	filled(value)
	b.pairs = append(b.pairs, encode(key)+"="+encode(value))
}

func (b *RequestBuilder) body(text string) {
	b.open()
	filled(text)
	b.text = &text
}

func (b *RequestBuilder) build() []string {
	if b.built == nil {
		if b.text != nil && (b.method == "GET" || b.method == "HEAD") {
			panic("this method takes no body")
		}
		headers := map[string]string{}
		for k, v := range b.headers {
			headers[k] = v
		}
		body := ""
		if b.text != nil {
			body = *b.text
			headers["Content-Length"] = strconv.Itoa(len(body))
		}
		names := make([]string, 0, len(headers))
		for n := range headers {
			names = append(names, n)
		}
		sort.Strings(names)
		target := b.url
		if len(b.pairs) > 0 {
			target += "?" + strings.Join(b.pairs, "&")
		}
		lines := []string{b.method + " " + target}
		for _, n := range names {
			lines = append(lines, n+": "+headers[n])
		}
		b.built = append(lines, "", body)
	}
	return append([]string{}, b.built...)
}

// The extension round: a shortcut that won't stack a second credential.
func (b *RequestBuilder) bearer(token string) bool {
	b.open()
	filled(token)
	if strings.Contains(token, " ") {
		panic("a token has no spaces")
	}
	if _, ok := b.headers["Authorization"]; ok {
		return false
	}
	b.headers["Authorization"] = "Bearer " + token
	return true
}
