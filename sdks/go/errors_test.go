package agentlens

import (
	"errors"
	"testing"
)

func TestErrorMapping(t *testing.T) {
	tests := []struct {
		status int
		check  func(error) bool
		name   string
	}{
		{400, func(e error) bool { var v *ValidationError; return errors.As(e, &v) }, "ValidationError"},
		{401, func(e error) bool { var v *AuthenticationError; return errors.As(e, &v) }, "AuthenticationError"},
		{402, func(e error) bool { var v *QuotaExceededError; return errors.As(e, &v) }, "QuotaExceededError"},
		{404, func(e error) bool { var v *NotFoundError; return errors.As(e, &v) }, "NotFoundError"},
		{429, func(e error) bool { var v *RateLimitError; return errors.As(e, &v) }, "RateLimitError"},
		{503, func(e error) bool { var v *BackpressureError; return errors.As(e, &v) }, "BackpressureError"},
		{500, func(e error) bool { var v *APIError; return errors.As(e, &v) }, "GenericError"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := mapHTTPError(tt.status, "test", nil, nil)
			if !tt.check(err) {
				t.Errorf("status %d: expected %s, got %T", tt.status, tt.name, err)
			}
		})
	}
}

func TestRateLimitRetryAfter(t *testing.T) {
	ra := 2.5
	err := mapHTTPError(429, "rate limited", nil, &ra)
	var rl *RateLimitError
	if !errors.As(err, &rl) {
		t.Fatal("expected RateLimitError")
	}
	if rl.RetryAfter == nil || *rl.RetryAfter != 2.5 {
		t.Errorf("expected RetryAfter=2.5, got %v", rl.RetryAfter)
	}
}

func TestConnectionErrorUnwrap(t *testing.T) {
	cause := errors.New("dns lookup failed")
	err := &ConnectionError{
		APIError: newAPIError("connection failed", 0, "CONNECTION_ERROR", nil),
		Cause: cause,
	}
	if !errors.Is(err, cause) {
		t.Error("ConnectionError should unwrap to cause")
	}
}

func TestErrorInterface(t *testing.T) {
	err := mapHTTPError(401, "bad token", nil, nil)
	msg := err.Error()
	if msg == "" {
		t.Error("error message should not be empty")
	}
}
