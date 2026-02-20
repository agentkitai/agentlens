package agentlens

import (
	"log/slog"
	"net/http"
	"time"
)

// ClientOption configures the Client.
type ClientOption func(*clientConfig)

type clientConfig struct {
	url        string
	apiKey     string
	httpClient *http.Client
	timeout    time.Duration
	retry      RetryConfig
	failOpen   bool
	onError    func(error)
	logger     *slog.Logger
}

func defaultConfig() clientConfig {
	return clientConfig{
		timeout: 30 * time.Second,
		retry:   defaultRetryConfig(),
	}
}

// WithTimeout sets the HTTP request timeout (default 30s).
func WithTimeout(d time.Duration) ClientOption {
	return func(c *clientConfig) { c.timeout = d }
}

// WithRetry overrides the retry configuration.
func WithRetry(cfg RetryConfig) ClientOption {
	return func(c *clientConfig) { c.retry = cfg }
}

// WithHTTPClient provides a custom *http.Client.
func WithHTTPClient(hc *http.Client) ClientOption {
	return func(c *clientConfig) { c.httpClient = hc }
}

// WithFailOpen enables fail-open mode. Errors are passed to onErr instead of returned.
func WithFailOpen(onErr func(error)) ClientOption {
	return func(c *clientConfig) {
		c.failOpen = true
		c.onError = onErr
	}
}

// WithLogger sets the logger for internal warnings.
func WithLogger(l *slog.Logger) ClientOption {
	return func(c *clientConfig) { c.logger = l }
}
