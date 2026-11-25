package main

import (
	"fmt"
	"strconv"
	"strings"
)

type semverParts [3]int64

// Each part is 1 to 9 digits with no leading zero.
func parseSemVer(text string) semverParts {
	parts := strings.Split(text, ".")
	if len(parts) != 3 {
		panic("a version is major.minor.patch")
	}
	var out semverParts
	for i, part := range parts {
		if part == "" || len(part) > 9 || strings.Trim(part, "0123456789") != "" {
			panic("each part is 1 to 9 digits")
		}
		if part[0] == '0' && len(part) > 1 {
			panic("no leading zeros")
		}
		out[i], _ = strconv.ParseInt(part, 10, 64)
	}
	return out
}

func compareSemVer(a, b semverParts) int64 {
	for i := range a {
		if a[i] != b[i] {
			if a[i] < b[i] {
				return -1
			}
			return 1
		}
	}
	return 0
}

func compatibleSemVer(a, b semverParts) bool {
	if a[0] != b[0] {
		return false
	}
	return a[0] > 0 || a[1] == b[1]
}

type SemVer struct {
	version semverParts
}

func NewSemVer(text string) *SemVer {
	return &SemVer{version: parseSemVer(text)}
}

func (s *SemVer) bump(part string) string {
	v := s.version
	switch part {
	case "major":
		return fmt.Sprintf("%d.0.0", v[0]+1)
	case "minor":
		return fmt.Sprintf("%d.%d.0", v[0], v[1]+1)
	case "patch":
		return fmt.Sprintf("%d.%d.%d", v[0], v[1], v[2]+1)
	}
	panic("part is major, minor or patch")
}

func (s *SemVer) compareTo(other string) int64 {
	return compareSemVer(s.version, parseSemVer(other))
}

func (s *SemVer) isCompatible(other string) bool {
	return compatibleSemVer(s.version, parseSemVer(other))
}

func (s *SemVer) text() string {
	return fmt.Sprintf("%d.%d.%d", s.version[0], s.version[1], s.version[2])
}

// The extension round.
func (s *SemVer) satisfies(constraint string) bool {
	if !strings.HasPrefix(constraint, "^") && !strings.HasPrefix(constraint, "~") {
		panic("a constraint is ^ or ~ and a version")
	}
	base := parseSemVer(constraint[1:])
	if compareSemVer(s.version, base) < 0 {
		return false
	}
	if constraint[0] == '^' {
		return compatibleSemVer(s.version, base)
	}
	return s.version[0] == base[0] && s.version[1] == base[1]
}
