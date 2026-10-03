// Package influx streams points to an InfluxDB v2 bucket over its HTTP write
// API, in line protocol. It is deliberately small and dependency-free: the
// backend writes one measurement, at about 80 points a second, and needs
// nothing from the official client that a gzip'd POST does not already give it.
package influx

import (
	"math"
	"strconv"
	"strings"
)

// Line builds one line-protocol point:
//
//	measurement,tag=value,tag=value field=1.5,field=2i,field="text" 1720000000
//
// Tags have to be added before the first field. Every value is escaped as the
// protocol asks, so tag values may carry the spaces and commas HSL puts in
// destination names.
type Line struct {
	buf    []byte
	fields int
}

// NewLine starts a point in the given measurement.
func NewLine(measurement string) *Line {
	l := &Line{buf: make([]byte, 0, 512)}
	l.buf = appendEscaped(l.buf, measurement, measurementEscaper)
	return l
}

// Tag adds an indexed tag. Empty values are skipped: InfluxDB rejects them.
func (l *Line) Tag(key, value string) *Line {
	if value == "" {
		return l
	}
	if l.fields > 0 {
		panic("influx: tag " + key + " added after a field")
	}
	l.buf = append(l.buf, ',')
	l.buf = appendEscaped(l.buf, key, tagEscaper)
	l.buf = append(l.buf, '=')
	l.buf = appendEscaped(l.buf, value, tagEscaper)
	return l
}

func (l *Line) fieldKey(key string) {
	if l.fields == 0 {
		l.buf = append(l.buf, ' ')
	} else {
		l.buf = append(l.buf, ',')
	}
	l.fields++
	l.buf = appendEscaped(l.buf, key, tagEscaper)
	l.buf = append(l.buf, '=')
}

// Float adds a float field. NaN and infinities have no line-protocol form and
// are skipped.
//
// A field keeps the type it was first written with for the life of a shard,
// and a point that disagrees is rejected whole. Writing a whole number here
// still produces a float, because only an `i` suffix makes an integer.
func (l *Line) Float(key string, v float64) *Line {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return l
	}
	l.fieldKey(key)
	l.buf = strconv.AppendFloat(l.buf, v, 'f', -1, 64)
	return l
}

// Int adds an integer field.
func (l *Line) Int(key string, v int64) *Line {
	l.fieldKey(key)
	l.buf = strconv.AppendInt(l.buf, v, 10)
	l.buf = append(l.buf, 'i')
	return l
}

// Bool adds a boolean field.
func (l *Line) Bool(key string, v bool) *Line {
	l.fieldKey(key)
	l.buf = strconv.AppendBool(l.buf, v)
	return l
}

// String adds a string field. Empty strings are skipped, so a field that is
// simply absent reads as null in a query rather than as "".
func (l *Line) String(key, v string) *Line {
	if v == "" {
		return l
	}
	l.fieldKey(key)
	l.buf = append(l.buf, '"')
	l.buf = appendEscaped(l.buf, v, stringEscaper)
	l.buf = append(l.buf, '"')
	return l
}

// End finishes the point with a timestamp in the writer's precision and
// returns it, or nil when no field was added — a point without fields is not
// a point.
func (l *Line) End(ts int64) []byte {
	if l.fields == 0 {
		return nil
	}
	l.buf = append(l.buf, ' ')
	l.buf = strconv.AppendInt(l.buf, ts, 10)
	return l.buf
}

// A newline ends a point and the protocol has no escape for one, so it is
// written as a space instead.
var (
	measurementEscaper = strings.NewReplacer(",", `\,`, " ", `\ `, "\n", `\ `)
	tagEscaper         = strings.NewReplacer(",", `\,`, "=", `\=`, " ", `\ `, "\n", `\ `)
	stringEscaper      = strings.NewReplacer(`\`, `\\`, `"`, `\"`, "\n", " ")
)

func appendEscaped(buf []byte, s string, r *strings.Replacer) []byte {
	return append(buf, r.Replace(s)...)
}
