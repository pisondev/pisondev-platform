package meeting

import (
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/pisondev/pisondev-platform/services/api/internal/platform/httpx"
)

type Store struct {
	db  *pgxpool.Pool
	now func() time.Time
}

func NewStore(db *pgxpool.Pool, now func() time.Time) *Store { return &Store{db: db, now: now} }

func (s *Store) Create(ctx context.Context, owner string, config Config) (*Poll, error) {
	if err := config.Validate(s.now()); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(config)
	if err != nil {
		return nil, err
	}
	id := token()
	_, err = s.db.Exec(ctx, `INSERT INTO meeting.polls(id,config,created_by) VALUES($1,$2,$3)`, id, raw, owner)
	if err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}

type querier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func load(ctx context.Context, q querier, id string, lock bool, now time.Time) (*Poll, string, error) {
	p := &Poll{Participants: []Participant{}}
	var config []byte
	var owner string
	query := `SELECT id, config, created_by, finalized_start, created_at FROM meeting.polls WHERE id=$1`
	if lock {
		query += ` FOR UPDATE`
	}
	err := q.QueryRow(ctx, query, id).Scan(&p.ID, &config, &owner, &p.FinalizedStart, &p.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", httpx.NotFound("This scheduling link does not exist.")
	}
	if err != nil {
		return nil, "", err
	}
	if err := json.Unmarshal(config, &p.Config); err != nil {
		return nil, "", err
	}
	rows, err := q.Query(ctx, `SELECT id,name,slots,version FROM meeting.responses WHERE poll_id=$1 ORDER BY updated_at,id`, id)
	if err != nil {
		return nil, "", err
	}
	defer rows.Close()
	for rows.Next() {
		var participant Participant
		if err := rows.Scan(&participant.ID, &participant.Name, &participant.Slots, &participant.Version); err != nil {
			return nil, "", err
		}
		p.Participants = append(p.Participants, participant)
	}
	if err := rows.Err(); err != nil {
		return nil, "", err
	}
	p.Slots = p.Config.Slots()
	p.Recommendations = Rank(p.Slots, p.Participants, p.Duration)
	if p.FinalizedStart == nil {
		future := []Recommendation{}
		for _, rec := range p.Recommendations {
			start, _ := time.Parse(time.RFC3339, rec.Start)
			if !start.Before(now) {
				future = append(future, rec)
			}
		}
		p.Recommendations = future
	}
	return p, owner, nil
}

func (s *Store) Get(ctx context.Context, id string) (*Poll, error) {
	// One snapshot keeps the finalization and responses internally consistent.
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	p, _, err := load(ctx, tx, id, false, s.now())
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return p, nil
}

type Summary struct {
	ID string `json:"id"`
	Config
	ParticipantCount int        `json:"participantCount"`
	FinalizedStart   *time.Time `json:"finalizedStart"`
	CreatedAt        time.Time  `json:"createdAt"`
}

func (s *Store) List(ctx context.Context, owner string) ([]Summary, error) {
	rows, err := s.db.Query(ctx, `SELECT p.id,p.config,p.finalized_start,p.created_at,
 (SELECT count(*) FROM meeting.responses r WHERE r.poll_id=p.id)
 FROM meeting.polls p WHERE created_by=$1 ORDER BY created_at DESC LIMIT 50`, owner)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Summary{}
	for rows.Next() {
		var item Summary
		var raw []byte
		if err := rows.Scan(&item.ID, &raw, &item.FinalizedStart, &item.CreatedAt, &item.ParticipantCount); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(raw, &item.Config); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func (s *Store) CanManage(ctx context.Context, id, owner string) (bool, error) {
	var allowed bool
	err := s.db.QueryRow(ctx, `SELECT created_by=$2 FROM meeting.polls WHERE id=$1`, id, owner).Scan(&allowed)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, httpx.NotFound("This scheduling link does not exist.")
	}
	return allowed, err
}

type SavedResponse struct {
	Participant Participant `json:"participant"`
	EditToken   string      `json:"editToken,omitempty"`
}

func (s *Store) Respond(ctx context.Context, pollID, participantID, key string, in ResponseInput) (*SavedResponse, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	p, _, err := load(ctx, tx, pollID, true, s.now())
	if err != nil {
		return nil, err
	}
	if p.FinalizedStart != nil {
		return nil, httpx.Conflict("poll_closed", "This meeting has been finalized. Ask the organizer to reopen it.", nil)
	}
	if err := validateResponse(&in, p.Slots); err != nil {
		return nil, err
	}
	saved := &SavedResponse{}
	if participantID == "" {
		if key != "" && (len(key) < 32 || len(key) > 128) {
			return nil, invalid("Invalid response edit key.")
		}
		if key == "" {
			key = token()
		}
		hash := sha256.Sum256([]byte(key))
		// A stable browser key makes a retry after a lost response safe.
		var existing Participant
		lookup := tx.QueryRow(ctx, `SELECT id,name,slots,version FROM meeting.responses WHERE poll_id=$1 AND edit_hash=$2`, pollID, hash[:]).Scan(&existing.ID, &existing.Name, &existing.Slots, &existing.Version)
		if lookup == nil {
			return &SavedResponse{Participant: existing}, tx.Commit(ctx)
		}
		if !errors.Is(lookup, pgx.ErrNoRows) {
			return nil, lookup
		}
		if len(p.Participants) >= 100 {
			return nil, httpx.Conflict("poll_full", "This poll has reached its 100-participant limit.", nil)
		}
		participantID, saved.EditToken = token(), key
		_, err = tx.Exec(ctx, `INSERT INTO meeting.responses(id,poll_id,name,slots,edit_hash) VALUES($1,$2,$3,$4,$5)`, participantID, pollID, in.Name, in.Slots, hash[:])
		in.Version = 1
	} else {
		var hash []byte
		var version int
		err = tx.QueryRow(ctx, `SELECT edit_hash,version FROM meeting.responses WHERE id=$1 AND poll_id=$2`, participantID, pollID).Scan(&hash, &version)
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, httpx.NotFound("This response does not exist.")
		}
		if err != nil {
			return nil, err
		}
		supplied := sha256.Sum256([]byte(key))
		if subtle.ConstantTimeCompare(hash, supplied[:]) != 1 {
			return nil, httpx.Forbidden("The edit key for this response is missing or invalid.")
		}
		if version != in.Version {
			return nil, httpx.Conflict("response_changed", "Your response changed in another tab. Reload your saved response before editing again.", nil)
		}
		in.Version++
		_, err = tx.Exec(ctx, `UPDATE meeting.responses SET name=$1,slots=$2,version=$3,updated_at=now() WHERE id=$4 AND poll_id=$5`, in.Name, in.Slots, in.Version, participantID, pollID)
	}
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	saved.Participant = Participant{ID: participantID, Name: in.Name, Slots: in.Slots, Version: in.Version}
	return saved, nil
}

func (s *Store) Finalize(ctx context.Context, id, owner string, start *string) (*Poll, error) {
	tx, err := s.db.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	p, createdBy, err := load(ctx, tx, id, true, s.now())
	if err != nil {
		return nil, err
	}
	if createdBy != owner {
		return nil, httpx.Forbidden("Only the organizer can change this meeting.")
	}
	var at *time.Time
	if start != nil {
		if p.FinalizedStart != nil {
			return nil, httpx.Conflict("poll_closed", "Reopen this meeting before choosing another time.", nil)
		}
		found := false
		for _, r := range p.Recommendations {
			if r.Start == *start {
				found = true
				break
			}
		}
		if !found {
			return nil, invalid("Choose a recommended time with at least one available participant.")
		}
		parsed, err := time.Parse(time.RFC3339, *start)
		if err != nil {
			return nil, invalid("Invalid meeting time.")
		}
		at = &parsed
	}
	_, err = tx.Exec(ctx, `UPDATE meeting.polls SET finalized_start=$1 WHERE id=$2`, at, id)
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return s.Get(ctx, id)
}
