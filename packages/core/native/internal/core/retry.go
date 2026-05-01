package core

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"

	"maunium.net/go/mautrix"
)

func retryMatrix[T any](ctx context.Context, run func() (T, error)) (T, error) {
	var zero T
	var last error
	delay := 250 * time.Millisecond
	for attempt := 0; attempt < 3; attempt++ {
		value, err := run()
		if err == nil {
			return value, nil
		}
		last = err
		if !isTransientMatrixError(err) || attempt == 2 {
			return zero, err
		}
		if retryAfter := matrixRetryAfter(err); retryAfter > delay {
			delay = retryAfter
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return zero, ctx.Err()
		case <-timer.C:
		}
		delay *= 2
	}
	return zero, last
}

func matrixRetryAfter(err error) time.Duration {
	var httpErr mautrix.HTTPError
	if !errors.As(err, &httpErr) || httpErr.Response == nil {
		return 0
	}
	header := httpErr.Response.Header.Get("Retry-After")
	if header == "" {
		return 0
	}
	if seconds, parseErr := time.ParseDuration(header + "s"); parseErr == nil {
		return seconds
	}
	if when, parseErr := http.ParseTime(header); parseErr == nil {
		return time.Until(when)
	}
	return 0
}

func retryMatrixVoid(ctx context.Context, run func() error) error {
	_, err := retryMatrix(ctx, func() (struct{}, error) {
		return struct{}{}, run()
	})
	return err
}

func isTransientMatrixError(err error) bool {
	if err == nil {
		return false
	}
	var httpErr mautrix.HTTPError
	if errors.As(err, &httpErr) {
		if httpErr.IsStatus(http.StatusRequestTimeout) ||
			httpErr.IsStatus(http.StatusTooEarly) ||
			httpErr.IsStatus(http.StatusTooManyRequests) ||
			httpErr.IsStatus(http.StatusInternalServerError) ||
			httpErr.IsStatus(http.StatusBadGateway) ||
			httpErr.IsStatus(http.StatusServiceUnavailable) ||
			httpErr.IsStatus(http.StatusGatewayTimeout) {
			return true
		}
	}
	var netErr net.Error
	if errors.As(err, &netErr) && (netErr.Timeout() || netErr.Temporary()) {
		return true
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "failed to query keys") ||
		strings.Contains(msg, "connection reset") ||
		strings.Contains(msg, "timeout") ||
		strings.Contains(msg, "temporary") ||
		strings.Contains(msg, "try again")
}
