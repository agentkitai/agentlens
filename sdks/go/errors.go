package agentlens

import "fmt"

// Error is the base error type for all AgentLens SDK errors.
type Error struct {
	Message string `json:"error"`
	Status  int    `json:"status"`
	Code    string `json:"code"`
	Details any    `json:"details,omitempty"`
}

func (e *Error) Error() string {
	if e.Status > 0 {
		return fmt.Sprintf("agentlens: %s (HTTP %d, code=%s)", e.Message, e.Status, e.Code)
	}
	return fmt.Sprintf("agentlens: %s (code=%s)", e.Message, e.Code)
}

// Unwrap returns nil — base error has no cause.
func (e *Error) Unwrap() error { return nil }

// AuthenticationError is returned when the server responds with 401.
type AuthenticationError struct{ *Error }

// NotFoundError is returned when the server responds with 404.
type NotFoundError struct{ *Error }

// ValidationError is returned when the server responds with 400.
type ValidationError struct{ *Error }

// ConnectionError is returned on network failures, DNS errors, or timeouts.
type ConnectionError struct {
	*Error
	Cause error
}

// Unwrap returns the underlying cause.
func (e *ConnectionError) Unwrap() error { return e.Cause }

// RateLimitError is returned when the server responds with 429.
type RateLimitError struct {
	*Error
	// RetryAfter is the number of seconds to wait before retrying, if provided by the server.
	RetryAfter *float64
}

// QuotaExceededError is returned when the server responds with 402.
type QuotaExceededError struct{ *Error }

// BackpressureError is returned when the server responds with 503.
type BackpressureError struct{ *Error }

// newError creates a base Error.
func newError(message string, status int, code string, details any) *Error {
	return &Error{Message: message, Status: status, Code: code, Details: details}
}

// mapHTTPError maps an HTTP status code and error body to the appropriate typed error.
func mapHTTPError(status int, message string, details any, retryAfterSec *float64) error {
	base := newError(message, status, "", details)
	switch status {
	case 400:
		base.Code = "VALIDATION_ERROR"
		return &ValidationError{base}
	case 401:
		base.Code = "AUTHENTICATION_ERROR"
		return &AuthenticationError{base}
	case 402:
		base.Code = "QUOTA_EXCEEDED"
		return &QuotaExceededError{base}
	case 404:
		base.Code = "NOT_FOUND"
		return &NotFoundError{base}
	case 429:
		base.Code = "RATE_LIMIT"
		return &RateLimitError{Error: base, RetryAfter: retryAfterSec}
	case 503:
		base.Code = "BACKPRESSURE"
		return &BackpressureError{base}
	default:
		base.Code = "API_ERROR"
		return base
	}
}
