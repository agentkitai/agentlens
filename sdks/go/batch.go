package agentlens

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"sync"
	"time"
)

// BatchOption configures the BatchSender.
type BatchOption func(*batchConfig)

type batchConfig struct {
	maxBatchSize  int
	flushInterval time.Duration
	maxQueueSize  int
	bufferDir     string
	onError       func(error)
}

func defaultBatchConfig() batchConfig {
	bufDir := os.Getenv("AGENTLENS_BUFFER_DIR")
	if bufDir == "" {
		bufDir = os.TempDir()
	}
	return batchConfig{
		maxBatchSize:  100,
		flushInterval: 5 * time.Second,
		maxQueueSize:  10000,
		bufferDir:     bufDir,
	}
}

// WithMaxBatchSize sets the maximum events per flush (default 100).
func WithMaxBatchSize(n int) BatchOption {
	return func(c *batchConfig) { c.maxBatchSize = n }
}

// WithFlushInterval sets the periodic flush interval (default 5s).
func WithFlushInterval(d time.Duration) BatchOption {
	return func(c *batchConfig) { c.flushInterval = d }
}

// WithMaxQueueSize sets the maximum queued events before dropping oldest (default 10000).
func WithMaxQueueSize(n int) BatchOption {
	return func(c *batchConfig) { c.maxQueueSize = n }
}

// WithBufferDir sets the directory for disk buffering on quota exceeded.
func WithBufferDir(dir string) BatchOption {
	return func(c *batchConfig) { c.bufferDir = dir }
}

// WithBatchOnError sets the error callback for non-fatal errors.
func WithBatchOnError(fn func(error)) BatchOption {
	return func(c *batchConfig) { c.onError = fn }
}

// BatchSender queues events and sends them in batches with auto-flush.
type BatchSender struct {
	sendFn func(ctx context.Context, events []Event) error
	cfg    batchConfig

	mu     sync.Mutex
	queue  []Event
	stopCh chan struct{}
	doneCh chan struct{}
}

// NewBatchSender creates a BatchSender with the given send function and options.
func NewBatchSender(sendFn func(ctx context.Context, events []Event) error, opts ...BatchOption) *BatchSender {
	cfg := defaultBatchConfig()
	for _, o := range opts {
		o(&cfg)
	}
	bs := &BatchSender{
		sendFn: sendFn,
		cfg:    cfg,
		queue:  make([]Event, 0, cfg.maxBatchSize),
		stopCh: make(chan struct{}),
		doneCh: make(chan struct{}),
	}
	go bs.loop()
	return bs
}

func (b *BatchSender) loop() {
	defer close(b.doneCh)
	ticker := time.NewTicker(b.cfg.flushInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			_ = b.Flush(context.Background())
		case <-b.stopCh:
			return
		}
	}
}

// Enqueue adds an event to the queue. Thread-safe.
func (b *BatchSender) Enqueue(event Event) {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.queue = append(b.queue, event)

	// Drop oldest on overflow
	if len(b.queue) > b.cfg.maxQueueSize {
		drop := len(b.queue) - b.cfg.maxQueueSize
		b.queue = b.queue[drop:]
		if b.cfg.onError != nil {
			b.cfg.onError(fmt.Errorf("queue overflow: dropped %d oldest event(s)", drop))
		}
	}

	// Auto-flush at batch size
	if len(b.queue) >= b.cfg.maxBatchSize {
		batch := make([]Event, b.cfg.maxBatchSize)
		copy(batch, b.queue[:b.cfg.maxBatchSize])
		b.queue = b.queue[b.cfg.maxBatchSize:]
		b.mu.Unlock()
		b.send(context.Background(), batch)
		b.mu.Lock()
	}
}

// Flush manually triggers an immediate flush.
func (b *BatchSender) Flush(ctx context.Context) error {
	b.mu.Lock()
	if len(b.queue) == 0 {
		b.mu.Unlock()
		return nil
	}
	n := b.cfg.maxBatchSize
	if n > len(b.queue) {
		n = len(b.queue)
	}
	batch := make([]Event, n)
	copy(batch, b.queue[:n])
	b.queue = b.queue[n:]
	b.mu.Unlock()

	b.send(ctx, batch)
	return nil
}

// Shutdown stops the background goroutine and drains remaining events.
func (b *BatchSender) Shutdown(ctx context.Context) error {
	close(b.stopCh)
	<-b.doneCh

	// Drain remaining
	for {
		b.mu.Lock()
		if len(b.queue) == 0 {
			b.mu.Unlock()
			return nil
		}
		b.mu.Unlock()

		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
			_ = b.Flush(ctx)
		}
	}
}

func (b *BatchSender) send(ctx context.Context, batch []Event) {
	err := b.sendFn(ctx, batch)
	if err == nil {
		return
	}

	// On 402 quota exceeded, buffer to disk
	var quotaErr *QuotaExceededError
	if errors.As(err, &quotaErr) {
		b.bufferToDisk(batch)
		return
	}

	if b.cfg.onError != nil {
		b.cfg.onError(err)
	}
}

func (b *BatchSender) bufferToDisk(events []Event) {
	if err := os.MkdirAll(b.cfg.bufferDir, 0o755); err != nil {
		if b.cfg.onError != nil {
			b.cfg.onError(fmt.Errorf("failed to create buffer dir: %w", err))
		}
		return
	}
	filename := fmt.Sprintf("agentlens-buffer-%d-%s.json", time.Now().UnixMilli(), randomSuffix())
	path := filepath.Join(b.cfg.bufferDir, filename)
	data, err := json.Marshal(events)
	if err != nil {
		if b.cfg.onError != nil {
			b.cfg.onError(fmt.Errorf("failed to marshal buffer: %w", err))
		}
		return
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		if b.cfg.onError != nil {
			b.cfg.onError(fmt.Errorf("failed to write buffer: %w", err))
		}
	}
}

func randomSuffix() string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, 6)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}
