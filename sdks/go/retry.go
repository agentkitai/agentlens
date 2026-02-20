package agentlens

import (
	"errors"
	"math"
	"math/rand"
	"time"
)

// RetryConfig controls the retry behavior of the client.
type RetryConfig struct {
	// MaxRetries is the maximum number of retry attempts (default 3).
	MaxRetries int
	// BackoffBase is the base delay for exponential backoff (default 1s).
	BackoffBase time.Duration
	// BackoffMax is the maximum delay between retries (default 30s).
	BackoffMax time.Duration
}

func defaultRetryConfig() RetryConfig {
	return RetryConfig{
		MaxRetries:  3,
		BackoffBase: time.Second,
		BackoffMax:  30 * time.Second,
	}
}

// shouldRetry returns true if the error is retryable.
func shouldRetry(err error) bool {
	if err == nil {
		return false
	}
	// Connection errors and timeouts are retryable
	var connErr *ConnectionError
	if errors.As(err, &connErr) {
		return true
	}
	// 429 and 503 are retryable
	var rlErr *RateLimitError
	if errors.As(err, &rlErr) {
		return true
	}
	var bpErr *BackpressureError
	if errors.As(err, &bpErr) {
		return true
	}
	return false
}

// backoffDelay calculates the delay for a given attempt:
// min(base * 2^attempt + rand(0, base), max)
func backoffDelay(cfg RetryConfig, attempt int) time.Duration {
	base := float64(cfg.BackoffBase)
	delay := base*math.Pow(2, float64(attempt)) + rand.Float64()*base
	max := float64(cfg.BackoffMax)
	if delay > max {
		delay = max
	}
	return time.Duration(delay)
}
