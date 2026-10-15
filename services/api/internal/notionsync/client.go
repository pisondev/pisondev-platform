// Package notionsync mirrors the finance tables with the Notion databases of the
// Finance Assistant. The Google Sheet keeps syncing with Notion through its own Apps
// Script, so Notion is the hub: Postgres <-> Notion <-> Sheet.
package notionsync

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const notionVersion = "2022-06-28"

// Client is a minimal Notion REST client with retries on rate limits and server errors.
type Client struct {
	token   string
	baseURL string
	http    *http.Client
}

func NewClient(token string) *Client {
	return &Client{token: token, baseURL: "https://api.notion.com/v1", http: &http.Client{Timeout: 30 * time.Second}}
}

// WithBaseURL points the client at another server, for tests.
func (c *Client) WithBaseURL(u string) *Client {
	c.baseURL = strings.TrimRight(u, "/")
	return c
}

type APIError struct {
	Status  int
	Code    string
	Message string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("notion %d %s: %s", e.Status, e.Code, e.Message)
}

// Page is the part of a Notion page the sync reads.
type Page struct {
	ID             string    `json:"id"`
	Archived       bool      `json:"archived"`
	InTrash        bool      `json:"in_trash"`
	LastEditedTime time.Time `json:"last_edited_time"`
	Parent         struct {
		DatabaseID string `json:"database_id"`
	} `json:"parent"`
	Properties map[string]json.RawMessage `json:"properties"`
}

type Database struct {
	ID         string `json:"id"`
	Properties map[string]struct {
		Type   string `json:"type"`
		Select *struct {
			Options []struct {
				Name string `json:"name"`
			} `json:"options"`
		} `json:"select"`
	} `json:"properties"`
}

func (c *Client) do(ctx context.Context, method, path string, body, out any) error {
	var payload []byte
	if body != nil {
		var err error
		if payload, err = json.Marshal(body); err != nil {
			return err
		}
	}
	for attempt := 0; ; attempt++ {
		req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, bytes.NewReader(payload))
		if err != nil {
			return err
		}
		req.Header.Set("Authorization", "Bearer "+c.token)
		req.Header.Set("Notion-Version", notionVersion)
		req.Header.Set("Content-Type", "application/json")
		res, err := c.http.Do(req)
		if err != nil {
			if attempt < 3 && ctx.Err() == nil {
				sleep(ctx, backoff(attempt, ""))
				continue
			}
			return err
		}
		data, _ := io.ReadAll(io.LimitReader(res.Body, 20<<20))
		res.Body.Close()
		if res.StatusCode >= 200 && res.StatusCode < 300 {
			if out == nil {
				return nil
			}
			return json.Unmarshal(data, out)
		}
		retry := res.StatusCode == 429 || res.StatusCode == 409 || res.StatusCode >= 500
		if retry && attempt < 4 && ctx.Err() == nil {
			sleep(ctx, backoff(attempt, res.Header.Get("Retry-After")))
			continue
		}
		apiErr := &APIError{Status: res.StatusCode}
		var e struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		}
		if json.Unmarshal(data, &e) == nil {
			apiErr.Code, apiErr.Message = e.Code, e.Message
		}
		return apiErr
	}
}

func backoff(attempt int, retryAfter string) time.Duration {
	if s, err := strconv.Atoi(strings.TrimSpace(retryAfter)); err == nil && s > 0 && s < 60 {
		return time.Duration(s) * time.Second
	}
	return time.Duration(attempt+1) * 1200 * time.Millisecond
}

func sleep(ctx context.Context, d time.Duration) {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
	case <-t.C:
	}
}

// QueryAll returns every live page of a database.
func (c *Client) QueryAll(ctx context.Context, dbID string) ([]Page, error) {
	var pages []Page
	cursor := ""
	for {
		body := map[string]any{"page_size": 100}
		if cursor != "" {
			body["start_cursor"] = cursor
		}
		var res struct {
			Results    []Page `json:"results"`
			HasMore    bool   `json:"has_more"`
			NextCursor string `json:"next_cursor"`
		}
		if err := c.do(ctx, http.MethodPost, "/databases/"+dbID+"/query", body, &res); err != nil {
			return nil, err
		}
		for _, p := range res.Results {
			if !p.Archived && !p.InTrash {
				pages = append(pages, p)
			}
		}
		if !res.HasMore || res.NextCursor == "" {
			return pages, nil
		}
		cursor = res.NextCursor
	}
}

func (c *Client) GetDatabase(ctx context.Context, dbID string) (Database, error) {
	var db Database
	err := c.do(ctx, http.MethodGet, "/databases/"+dbID, nil, &db)
	return db, err
}

func (c *Client) GetPage(ctx context.Context, id string) (Page, error) {
	var p Page
	err := c.do(ctx, http.MethodGet, "/pages/"+id, nil, &p)
	return p, err
}

func (c *Client) CreatePage(ctx context.Context, dbID string, props map[string]any) (Page, error) {
	var p Page
	err := c.do(ctx, http.MethodPost, "/pages", map[string]any{
		"parent": map[string]string{"database_id": dbID}, "properties": props,
	}, &p)
	return p, err
}

// UpdatePage patches properties, and archives or restores the page when archived is set.
func (c *Client) UpdatePage(ctx context.Context, id string, props map[string]any, archived *bool) (Page, error) {
	body := map[string]any{}
	if len(props) > 0 {
		body["properties"] = props
	}
	if archived != nil {
		body["archived"] = *archived
	}
	var p Page
	err := c.do(ctx, http.MethodPatch, "/pages/"+id, body, &p)
	return p, err
}

// BotID returns the user id of this integration, used to ignore its own webhook echoes.
func (c *Client) BotID(ctx context.Context) (string, error) {
	var u struct {
		ID string `json:"id"`
	}
	err := c.do(ctx, http.MethodGet, "/users/me", nil, &u)
	return bare(u.ID), err
}

func bare(id string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(id), "-", ""))
}
