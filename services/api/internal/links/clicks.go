package links

import (
	"context"
	"log/slog"
	"time"
)

// Recorder writes visits in the background, so a redirect never waits for the database.
// Visits are batched; when the queue is full a visit is dropped, never the redirect.
type Recorder struct {
	store *Store
	queue chan click
	log   *slog.Logger
	done  chan struct{}
}

const (
	queueSize  = 1024
	batchSize  = 200
	flushEvery = 2 * time.Second
)

func NewRecorder(store *Store, log *slog.Logger) *Recorder {
	return &Recorder{store: store, queue: make(chan click, queueSize), log: log, done: make(chan struct{})}
}

// Add queues one visit. It never blocks.
func (r *Recorder) Add(c click) {
	select {
	case r.queue <- c:
	default:
		r.log.Warn("link click dropped, queue full", "link", c.linkID)
	}
}

// Run writes queued visits until ctx ends, then flushes what is left.
func (r *Recorder) Run(ctx context.Context) {
	defer close(r.done)
	t := time.NewTicker(flushEvery)
	defer t.Stop()
	var batch []click
	flush := func(ctx context.Context) {
		if len(batch) == 0 {
			return
		}
		if err := r.store.SaveClicks(ctx, batch); err != nil {
			r.log.Error("save link clicks", "err", err, "count", len(batch))
		}
		batch = batch[:0]
	}
	for {
		select {
		case c := <-r.queue:
			batch = append(batch, c)
			if len(batch) >= batchSize {
				flush(ctx)
			}
		case <-t.C:
			flush(ctx)
		case <-ctx.Done():
			for {
				select {
				case c := <-r.queue:
					batch = append(batch, c)
				default:
					final, cancel := context.WithTimeout(context.Background(), 5*time.Second)
					flush(final)
					cancel()
					return
				}
			}
		}
	}
}

// Wait returns once Run has flushed and stopped.
func (r *Recorder) Wait() { <-r.done }
