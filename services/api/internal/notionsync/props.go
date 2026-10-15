package notionsync

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/pisondev/pisondev-platform/services/api/internal/finance"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
)

// Canonical text per property kind, identical to the sheet sync (Code.gs):
//   date         2026-09-29 or 2026-09-29T21:00 in WIB; 00:00 collapses to the date
//   number       65000
//   title, text  plain text with \n line breaks
//   select       option name
//   empty        ""

type rawProp struct {
	Type     string     `json:"type"`
	Title    []richText `json:"title"`
	RichText []richText `json:"rich_text"`
	Select   *struct {
		Name string `json:"name"`
	} `json:"select"`
	Number *json.Number `json:"number"`
	Date   *struct {
		Start string `json:"start"`
	} `json:"date"`
}

type richText struct {
	PlainText string `json:"plain_text"`
}

// fromNotion converts one property of a page to canonical text.
func fromNotion(raw json.RawMessage, f finance.Field) (string, error) {
	var p rawProp
	if err := json.Unmarshal(raw, &p); err != nil {
		return "", err
	}
	if p.Type != f.Kind {
		return "", fmt.Errorf("property %q is %s in Notion, expected %s", f.Name, p.Type, f.Kind)
	}
	switch f.Kind {
	case "title", "rich_text":
		parts := p.Title
		if f.Kind == "rich_text" {
			parts = p.RichText
		}
		var b strings.Builder
		for _, t := range parts {
			b.WriteString(t.PlainText)
		}
		return strings.ReplaceAll(b.String(), "\r\n", "\n"), nil
	case "select":
		if p.Select == nil {
			return "", nil
		}
		return p.Select.Name, nil
	case "number":
		if p.Number == nil {
			return "", nil
		}
		return numberText(string(*p.Number))
	case "date":
		if p.Date == nil || p.Date.Start == "" {
			return "", nil
		}
		return dateText(p.Date.Start)
	}
	return "", fmt.Errorf("unsupported property kind %q", f.Kind)
}

func numberText(s string) (string, error) {
	if n, err := strconv.ParseInt(s, 10, 64); err == nil {
		return strconv.FormatInt(n, 10), nil
	}
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return "", err
	}
	return strconv.FormatFloat(f, 'f', -1, 64), nil
}

func dateText(start string) (string, error) {
	if len(start) <= 10 {
		return start, nil
	}
	t, err := time.Parse(time.RFC3339, start)
	if err != nil {
		return "", fmt.Errorf("invalid date %q", start)
	}
	d := finance.DateTimeOf(t.In(clock.WIB))
	return d.String(), nil
}

// toNotion converts canonical text to a property value for the Notion API.
func toNotion(text string, f finance.Field) (any, error) {
	switch f.Kind {
	case "title", "rich_text":
		parts := []map[string]any{}
		runes := []rune(text)
		for i := 0; i < len(runes); i += 1800 {
			end := min(i+1800, len(runes))
			parts = append(parts, map[string]any{"type": "text", "text": map[string]string{"content": string(runes[i:end])}})
		}
		return map[string]any{f.Kind: parts}, nil
	case "select":
		if text == "" {
			return map[string]any{"select": nil}, nil
		}
		return map[string]any{"select": map[string]string{"name": text}}, nil
	case "number":
		if text == "" {
			return map[string]any{"number": nil}, nil
		}
		n, err := strconv.ParseFloat(text, 64)
		if err != nil {
			return nil, err
		}
		return map[string]any{"number": n}, nil
	case "date":
		if text == "" {
			return map[string]any{"date": nil}, nil
		}
		d, err := finance.ParseLocalDate(text)
		if err != nil {
			return nil, err
		}
		if !d.HasTime() {
			return map[string]any{"date": map[string]string{"start": d.String()}}, nil
		}
		return map[string]any{"date": map[string]string{"start": d.Time().Format("2006-01-02T15:04:05-07:00")}}, nil
	}
	return nil, fmt.Errorf("unsupported property kind %q", f.Kind)
}

// pageValues reads the canonical values of a page in field order.
func pageValues(p Page, fields []finance.Field) ([]string, error) {
	vals := make([]string, len(fields))
	for i, f := range fields {
		raw, ok := p.Properties[f.Name]
		if !ok {
			return nil, fmt.Errorf("property %q is missing in Notion", f.Name)
		}
		v, err := fromNotion(raw, f)
		if err != nil {
			return nil, err
		}
		vals[i] = v
	}
	return vals, nil
}

// properties builds the API payload for the given field indexes, or all when only is nil.
func properties(vals []string, fields []finance.Field, only map[int]bool) (map[string]any, error) {
	out := map[string]any{}
	for i, f := range fields {
		if only != nil && !only[i] {
			continue
		}
		v, err := toNotion(vals[i], f)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", f.Name, err)
		}
		out[f.Name] = v
	}
	return out, nil
}
