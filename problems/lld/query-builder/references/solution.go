package main

import (
	"regexp"
	"strconv"
	"strings"
)

var queryPlain = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
var queryOps = map[string]bool{"=": true, "<>": true, "<": true, "<=": true, ">": true, ">=": true, "LIKE": true}

const queryMaxLimit = 1_000_000_000

// Identifiers go into the text, so only a plain name may: no quotes, spaces or dots.
func plainName(identifier string) string {
	if !queryPlain.MatchString(identifier) {
		panic("not a plain name")
	}
	return identifier
}

// A builder: each call records one part of the query, and build() assembles them in
// SQL's order whatever order they came in. Values are only ever kept as parameters, so
// nothing a caller passes as a value can change the statement.
type QueryBuilder struct {
	table      string
	selected   []string
	conditions []string
	values     []string
	order      []string
	ordered    map[string]bool
	rows       *int64
	joins      []string
	joined     map[string]bool
}

func NewQueryBuilder(table string) *QueryBuilder {
	return &QueryBuilder{table: plainName(table), ordered: map[string]bool{}, joined: map[string]bool{table: true}}
}

func (q *QueryBuilder) columns(cols []string) {
	seen := map[string]bool{}
	for _, c := range cols {
		seen[c] = true
	}
	if len(cols) == 0 || len(seen) != len(cols) {
		panic("no columns, or one twice")
	}
	for _, c := range cols {
		plainName(c)
	}
	q.selected = append([]string{}, cols...)
}

func (q *QueryBuilder) where(column string, op string, val string) {
	plainName(column)
	if !queryOps[op] {
		panic("unknown operator")
	}
	if val == "" {
		panic("empty value")
	}
	q.values = append(q.values, val)
	q.conditions = append(q.conditions, column+" "+op+" $"+strconv.Itoa(len(q.values)))
}

func (q *QueryBuilder) orderBy(column string, desc bool) {
	if q.ordered[plainName(column)] {
		panic("already ordered by it")
	}
	q.ordered[column] = true
	direction := " ASC"
	if desc {
		direction = " DESC"
	}
	q.order = append(q.order, column+direction)
}

func (q *QueryBuilder) limit(n int64) {
	if n < 1 || n > queryMaxLimit {
		panic("limit out of range")
	}
	q.rows = &n
}

func (q *QueryBuilder) build() string {
	selected := "*"
	if len(q.selected) > 0 {
		selected = strings.Join(q.selected, ", ")
	}
	sql := "SELECT " + selected + " FROM " + q.table + strings.Join(q.joins, "")
	if len(q.conditions) > 0 {
		sql += " WHERE " + strings.Join(q.conditions, " AND ")
	}
	if len(q.order) > 0 {
		sql += " ORDER BY " + strings.Join(q.order, ", ")
	}
	if q.rows != nil {
		sql += " LIMIT " + strconv.FormatInt(*q.rows, 10)
	}
	return sql
}

func (q *QueryBuilder) params() []string {
	return append([]string{}, q.values...)
}

// The extension round: joining another table.
func (q *QueryBuilder) innerJoin(table string, leftColumn string, rightColumn string) {
	for _, identifier := range []string{table, leftColumn, rightColumn} {
		plainName(identifier)
	}
	if q.joined[table] {
		panic("table already in the query")
	}
	q.joined[table] = true
	q.joins = append(q.joins, " INNER JOIN "+table+" ON "+q.table+"."+leftColumn+" = "+table+"."+rightColumn)
}
