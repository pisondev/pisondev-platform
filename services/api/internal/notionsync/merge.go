package notionsync

import "github.com/pisondev/pisondev-platform/services/api/internal/finance"

// mergeResult says, per field index, which side must be updated.
type mergeResult struct {
	toLocal  map[int]bool
	toRemote map[int]bool
	final    []string
	dirty    bool // local row must be written: values or base changed
}

// merge is a field-by-field 3-way merge between the local row and its Notion page,
// using base (values at the last sync) to tell which side changed. Same rules as the
// sheet sync:
//   - changed on one side only: copy it to the other side;
//   - changed on both sides: local wins, since local edits reach Notion within seconds
//     and are almost always the latest;
//   - external fields (computed by the sheet): Notion always wins, never pushed;
//   - no base yet: Notion wins.
//
// With pullOnly, Notion wins every field and nothing is pushed.
func merge(local, remote, base []string, fields []finance.Field, pullOnly bool) mergeResult {
	m := mergeResult{toLocal: map[int]bool{}, toRemote: map[int]bool{}, final: make([]string, len(local))}
	hasBase := base != nil && len(base) == len(local)
	for i := range local {
		l, r := local[i], remote[i]
		if l == r {
			m.final[i] = l
			continue
		}
		takeLocal := false
		switch {
		case pullOnly, fields[i].External, !hasBase:
			takeLocal = false
		default:
			// Changed only in Notion: take Notion. Otherwise local wins.
			takeLocal = !(r != base[i] && l == base[i])
		}
		if takeLocal {
			m.toRemote[i] = true
			m.final[i] = l
		} else {
			m.toLocal[i] = true
			m.final[i] = r
		}
	}
	m.dirty = !hasBase || !equal(m.final, base) || len(m.toLocal) > 0
	return m
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
