package links

import (
	"context"
	"errors"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/pisondev/pisondev-platform/services/api/internal/platform/clock"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

type Service struct {
	store     *Store
	baseURL   string // e.g. https://go.pisondev.com
	shortHost string
	now       clock.Clock
}

func NewService(store *Store, baseURL string, now clock.Clock) *Service {
	baseURL = strings.TrimRight(baseURL, "/")
	host := ""
	if u, err := url.Parse(baseURL); err == nil {
		host = u.Hostname()
	}
	return &Service{store: store, baseURL: baseURL, shortHost: host, now: now}
}

func (s *Service) withShort(l Link) Link {
	l.ShortURL = s.baseURL + "/" + l.Slug
	return l
}

type fieldErrors map[string]any

func (f fieldErrors) err() error {
	if len(f) == 0 {
		return nil
	}
	return httpx.BadRequest("invalid_input", "Some fields are invalid.", f)
}

func (s *Service) List(ctx context.Context, q string, limit int) ([]Link, error) {
	out, err := s.store.List(ctx, strings.TrimSpace(q), limit)
	for i := range out {
		out[i] = s.withShort(out[i])
	}
	return out, err
}

func (s *Service) Get(ctx context.Context, id string) (Link, error) {
	l, err := s.store.Get(ctx, id)
	if errors.Is(err, errNotFound) {
		return l, httpx.NotFound("Link not found.")
	}
	return s.withShort(l), err
}

// CreateInput is a new link. An empty slug gets a random one.
type CreateInput struct {
	Target    string     `json:"target"`
	Slug      string     `json:"slug"`
	Title     string     `json:"title"`
	Notes     string     `json:"notes"`
	ExpiresAt *time.Time `json:"expiresAt"`
}

func (s *Service) Create(ctx context.Context, actor string, in CreateInput) (Link, error) {
	errs := fieldErrors{}
	l := Link{Enabled: true, ExpiresAt: in.ExpiresAt}
	var err error
	if l.Target, err = NormalizeTarget(in.Target, s.shortHost); err != nil {
		errs["target"] = err.Error()
	}
	custom := strings.TrimSpace(in.Slug) != ""
	if custom {
		if l.Slug, err = NormalizeSlug(in.Slug); err != nil {
			errs["slug"] = err.Error()
		}
	}
	s.checkText(&l, in.Title, in.Notes, errs)
	if l.ExpiresAt != nil && !l.ExpiresAt.After(s.now()) {
		errs["expiresAt"] = "Expiry is in the past."
	}
	if err := errs.err(); err != nil {
		return Link{}, err
	}
	for attempt := 0; ; attempt++ {
		if !custom {
			l.Slug = RandomSlug()
		}
		err = s.store.Insert(ctx, &l, actor)
		if !errors.Is(err, errSlugTaken) {
			break
		}
		if custom {
			return Link{}, httpx.Conflict("slug_taken", "This slug is already used.", map[string]any{"slug": l.Slug})
		}
		if attempt >= 4 {
			return Link{}, err
		}
	}
	if err != nil {
		return Link{}, err
	}
	return s.withShort(l), nil
}

func (s *Service) checkText(l *Link, title, notes string, errs fieldErrors) {
	l.Title, l.Notes = strings.TrimSpace(title), strings.TrimSpace(notes)
	if utf8.RuneCountInString(l.Title) > maxTitle {
		errs["title"] = "Title is longer than 120 characters."
	}
	if utf8.RuneCountInString(l.Notes) > maxNotes {
		errs["notes"] = "Notes are longer than 500 characters."
	}
}

// PatchInput changes some fields. Nil means unchanged; an empty expiresAt clears it.
type PatchInput struct {
	Target    *string `json:"target"`
	Slug      *string `json:"slug"`
	Title     *string `json:"title"`
	Notes     *string `json:"notes"`
	Enabled   *bool   `json:"enabled"`
	ExpiresAt *string `json:"expiresAt"`
}

func (s *Service) Update(ctx context.Context, actor, id string, in PatchInput) (Link, error) {
	l, err := s.store.Get(ctx, id)
	if errors.Is(err, errNotFound) {
		return Link{}, httpx.NotFound("Link not found.")
	}
	if err != nil {
		return Link{}, err
	}
	errs := fieldErrors{}
	if in.Target != nil {
		if l.Target, err = NormalizeTarget(*in.Target, s.shortHost); err != nil {
			errs["target"] = err.Error()
		}
	}
	if in.Slug != nil {
		slug, err := NormalizeSlug(*in.Slug)
		switch {
		case err != nil:
			errs["slug"] = err.Error()
		case slug != l.Slug && l.Clicks > 0:
			// Someone already followed the old slug; renaming would break it.
			errs["slug"] = "The slug cannot change once the link has visits. Make a new link instead."
		default:
			l.Slug = slug
		}
	}
	title, notes := l.Title, l.Notes
	if in.Title != nil {
		title = *in.Title
	}
	if in.Notes != nil {
		notes = *in.Notes
	}
	s.checkText(&l, title, notes, errs)
	if in.Enabled != nil {
		l.Enabled = *in.Enabled
	}
	if in.ExpiresAt != nil {
		if strings.TrimSpace(*in.ExpiresAt) == "" {
			l.ExpiresAt = nil
		} else if t, err := time.Parse(time.RFC3339, *in.ExpiresAt); err != nil {
			errs["expiresAt"] = "Expiry must be an RFC 3339 time."
		} else {
			l.ExpiresAt = &t
		}
	}
	if err := errs.err(); err != nil {
		return Link{}, err
	}
	err = s.store.Update(ctx, &l, actor)
	if errors.Is(err, errSlugTaken) {
		return Link{}, httpx.Conflict("slug_taken", "This slug is already used.", map[string]any{"slug": l.Slug})
	}
	if err != nil {
		return Link{}, err
	}
	return s.Get(ctx, id)
}

func (s *Service) Delete(ctx context.Context, actor, id string) error {
	err := s.store.Delete(ctx, id, actor)
	if errors.Is(err, errNotFound) {
		return httpx.NotFound("Link not found.")
	}
	return err
}

func (s *Service) Stats(ctx context.Context, id string, days int) (Stats, error) {
	if _, err := s.Get(ctx, id); err != nil {
		return Stats{}, err
	}
	return s.store.Stats(ctx, id, days)
}
