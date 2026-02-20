package agentlens

import (
	"context"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestBatchFlushAtThreshold(t *testing.T) {
	var sent atomic.Int32
	bs := NewBatchSender(func(ctx context.Context, events []Event) error {
		sent.Add(int32(len(events)))
		return nil
	}, WithMaxBatchSize(5), WithFlushInterval(time.Hour))
	defer bs.Shutdown(context.Background())

	for i := 0; i < 5; i++ {
		bs.Enqueue(Event{ID: "e"})
	}
	time.Sleep(50 * time.Millisecond) // let async send complete
	if sent.Load() != 5 {
		t.Errorf("expected 5 sent, got %d", sent.Load())
	}
}

func TestBatchFlushOnTimer(t *testing.T) {
	var sent atomic.Int32
	bs := NewBatchSender(func(ctx context.Context, events []Event) error {
		sent.Add(int32(len(events)))
		return nil
	}, WithMaxBatchSize(100), WithFlushInterval(50*time.Millisecond))

	bs.Enqueue(Event{ID: "e1"})
	time.Sleep(150 * time.Millisecond)
	bs.Shutdown(context.Background())

	if sent.Load() != 1 {
		t.Errorf("expected 1 sent via timer, got %d", sent.Load())
	}
}

func TestBatchShutdownDrain(t *testing.T) {
	var sent atomic.Int32
	bs := NewBatchSender(func(ctx context.Context, events []Event) error {
		sent.Add(int32(len(events)))
		return nil
	}, WithMaxBatchSize(100), WithFlushInterval(time.Hour))

	for i := 0; i < 10; i++ {
		bs.Enqueue(Event{ID: "e"})
	}
	bs.Shutdown(context.Background())

	if sent.Load() != 10 {
		t.Errorf("expected 10 drained on shutdown, got %d", sent.Load())
	}
}

func TestBatchOverflow(t *testing.T) {
	var mu sync.Mutex
	var errMsg string
	bs := NewBatchSender(func(ctx context.Context, events []Event) error {
		return nil
	},
		WithMaxBatchSize(1000),
		WithFlushInterval(time.Hour),
		WithMaxQueueSize(5),
		WithBatchOnError(func(err error) {
			mu.Lock()
			errMsg = err.Error()
			mu.Unlock()
		}),
	)
	defer bs.Shutdown(context.Background())

	for i := 0; i < 10; i++ {
		bs.Enqueue(Event{ID: "e"})
	}

	mu.Lock()
	if errMsg == "" {
		t.Error("expected overflow error")
	}
	mu.Unlock()
}

func TestBatch402DiskBuffer(t *testing.T) {
	dir := t.TempDir()
	bs := NewBatchSender(func(ctx context.Context, events []Event) error {
		return &QuotaExceededError{newAPIError("quota exceeded", 402, "QUOTA_EXCEEDED", nil)}
	}, WithMaxBatchSize(2), WithFlushInterval(time.Hour), WithBufferDir(dir))

	bs.Enqueue(Event{ID: "e1"})
	bs.Enqueue(Event{ID: "e2"})
	time.Sleep(50 * time.Millisecond)
	bs.Shutdown(context.Background())

	entries, _ := os.ReadDir(dir)
	found := false
	for _, e := range entries {
		if matched, _ := filepath.Match("agentlens-buffer-*.json", e.Name()); matched {
			found = true
		}
	}
	if !found {
		t.Error("expected buffer file on disk")
	}
}

func TestBatchConcurrentEnqueue(t *testing.T) {
	var sent atomic.Int32
	bs := NewBatchSender(func(ctx context.Context, events []Event) error {
		sent.Add(int32(len(events)))
		return nil
	}, WithMaxBatchSize(50), WithFlushInterval(time.Hour))

	var wg sync.WaitGroup
	for i := 0; i < 10; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < 10; j++ {
				bs.Enqueue(Event{ID: "e"})
			}
		}()
	}
	wg.Wait()
	bs.Shutdown(context.Background())

	if sent.Load() != 100 {
		t.Errorf("expected 100 sent, got %d", sent.Load())
	}
}
