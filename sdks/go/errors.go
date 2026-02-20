package agentlens

import "fmt"

// APIError is the base error type for all AgentLens SDK errors.
type APIError struct {
	Message string `json:"error"`
	Status  int    `json:"status"`
	Code    string `json:"code"`
	Details any    `json:"details,omitempty"`
}

func (e *APIError) Error() string {
	if e.Status > 0 {
		return fmt.Sprintf("agentlens: %s (HTTP %d, code=%s)", e.Message, e.Status, e.Code)
	}
	return fmt.Sprintf("agentlens: %s (code=%s)", e.Message, e.Code)
}

// AuthenticationError is returned when the server responds with 401.
type AuthenticationError struct{ *APIError }

// NotFoundError is returned when the server responds with 404.
type NotFoundError struct{ *APIError }

// ValidationError is returned when the server responds with 400.
type ValidationError struct{ *APIError }

// ConnectionError is returned on network failures, DNS errors, or timeouts.
type ConnectionError struct {
	*APIError
	Cause error
}

// Unwrap returns the underlying cause.
func (e *ConnectionError) Unwrap() error { return e.Cause }

// RateLimitError is returned when the server responds with 429.
type RateLimitError struct {
	*APIError
	// RetryAfter is the number of seconds to wait before retrying, if provided by the server.
	RetryAfter *float64
}

// QuotaExceededError is returned when the server responds with 402.
type QuotaExceededError struct{ *APIError }

// BackpressureError is returned when the server responds with 503.
type BackpressureError struct{ *APIError }

// newAPIError creates a base APIError.
func newAPIError(message string, status int, code string, details any) *APIError {
	return &APIError{Message: message, Status: status, Code: code, Details: details}
}

// mapHTTPError maps an HTTP status code and error body to the appropriate typed error.
func mapHTTPError(status int, message string, details any, retryAfterSec *float64) error {
	switch status {
	case 400:
		return &ValidationError{newAPIError(message, status, "VALIDATION_ERROR", details)}
	case 401:
		return &AuthenticationError{newAPIError(message, status, "AUTHENTICATION_ERROR", details)}
	case 402:
		return &QuotaExceededError{newAPIError(message, status, "QUOTA_EXCEEDED", details)}
	case 404:
		return &NotFoundError{newAPIError(message, status, "NOT_FOUND", details)}
	case 429:
		return &RateLimitError{APIError: newAPIError(message, status, "RATE_LIMIT", details), RetryAfter: retryAfterSec}
	case 503:
		return &BackpressureError{newAPIError(message, status, "BACKPRESSURE", details)}
	default:
		return newAPIError(message, status, "API_ERROR", details)
	}
}
