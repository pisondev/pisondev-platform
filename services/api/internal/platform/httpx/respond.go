// Package httpx holds the JSON envelope, typed errors, and shared middleware.
package httpx

import (
	"errors"
	"log/slog"
	"net/http"

	"github.com/gin-gonic/gin"
)

// Error is an error safe to show to the client.
type Error struct {
	Status  int            `json:"-"`
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func BadRequest(code, msg string, details map[string]any) *Error {
	return &Error{Status: http.StatusBadRequest, Code: code, Message: msg, Details: details}
}
func NotFound(msg string) *Error {
	return &Error{Status: http.StatusNotFound, Code: "not_found", Message: msg}
}
func Conflict(code, msg string, details map[string]any) *Error {
	return &Error{Status: http.StatusConflict, Code: code, Message: msg, Details: details}
}
func Unauthorized(msg string) *Error {
	return &Error{Status: http.StatusUnauthorized, Code: "unauthorized", Message: msg}
}
func Forbidden(msg string) *Error {
	return &Error{Status: http.StatusForbidden, Code: "forbidden", Message: msg}
}
func Unavailable(code, msg string) *Error {
	return &Error{Status: http.StatusServiceUnavailable, Code: code, Message: msg}
}

// OK writes {"data": v}.
func OK(c *gin.Context, status int, v any) {
	c.JSON(status, gin.H{"data": v})
}

// Fail writes {"error": {...}}. Unknown errors become a generic 500 and are logged.
func Fail(c *gin.Context, err error) {
	var e *Error
	if !errors.As(err, &e) {
		slog.ErrorContext(c.Request.Context(), "request failed", "err", err, "path", c.FullPath(), "request_id", RequestID(c))
		e = &Error{Status: http.StatusInternalServerError, Code: "internal", Message: "Something went wrong."}
	}
	c.AbortWithStatusJSON(e.Status, gin.H{"error": e})
}
