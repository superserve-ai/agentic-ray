"""Exception classes for Superserve SDK."""

from __future__ import annotations

from typing import Any


class SuperserveError(Exception):
    """Base exception for all Superserve SDK errors."""

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)


class APIError(SuperserveError):
    """Error returned from the Superserve API.

    Attributes:
        status_code: HTTP status code from the API.
        message: Error message.
        details: Additional error details from the API.
    """

    def __init__(
        self,
        status_code: int,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.status_code = status_code
        self.details = details or {}
        super().__init__(f"[{status_code}] {message}")

    @property
    def is_retryable(self) -> bool:
        """Check if this error is retryable.

        Returns:
            True if the error could be resolved by retrying.
        """
        # 429 Too Many Requests, 500+ Server Errors
        return self.status_code == 429 or self.status_code >= 500


class AuthenticationError(APIError):
    """Authentication failed.

    This error is raised when:
    - No API key is provided
    - The API key is invalid
    - The API key has expired
    """

    def __init__(
        self,
        message: str = "Authentication failed",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(401, message, details)


class NotFoundError(APIError):
    """Resource not found.

    This error is raised when:
    - An agent ID doesn't exist
    - A run ID doesn't exist
    - Any other requested resource is not found
    """

    def __init__(
        self,
        resource: str = "Resource",
        resource_id: str = "",
        details: dict[str, Any] | None = None,
    ) -> None:
        self.resource = resource
        self.resource_id = resource_id
        message = (
            f"{resource} '{resource_id}' not found" if resource_id else f"{resource} not found"
        )
        super().__init__(404, message, details)


class ValidationError(APIError):
    """Request validation failed.

    This error is raised when:
    - Request body validation fails
    - Invalid parameter values are provided
    - Required fields are missing
    """

    def __init__(
        self,
        message: str = "Validation error",
        field: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.field = field
        full_message = f"{message} (field: {field})" if field else message
        super().__init__(422, full_message, details)


class ConflictError(APIError):
    """Resource conflict error.

    This error is raised when:
    - Trying to create an agent with a name that already exists
    - Trying to perform an operation that conflicts with current state
    """

    def __init__(
        self,
        message: str = "Resource conflict",
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(409, message, details)


class RateLimitError(APIError):
    """Rate limit exceeded.

    This error is raised when too many requests are made in a short period.

    Attributes:
        retry_after: Seconds to wait before retrying (if provided by API).
    """

    def __init__(
        self,
        message: str = "Rate limit exceeded",
        retry_after: int | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        self.retry_after = retry_after
        super().__init__(429, message, details)


class StreamError(SuperserveError):
    """Error during SSE streaming.

    This error is raised when:
    - Connection is lost during streaming
    - Invalid SSE data is received
    - Stream parsing fails
    """

    def __init__(
        self,
        message: str,
        cause: Exception | None = None,
    ) -> None:
        self.cause = cause
        super().__init__(message)


class ConnectionError(SuperserveError):
    """Failed to connect to the Superserve API.

    This error is raised when:
    - Network is unavailable
    - API host is unreachable
    - Connection times out
    """

    def __init__(
        self,
        message: str = "Failed to connect to Superserve API",
        cause: Exception | None = None,
    ) -> None:
        self.cause = cause
        super().__init__(message)


class TimeoutError(SuperserveError):
    """Request timed out.

    This error is raised when a request takes longer than the configured timeout.
    """

    def __init__(
        self,
        message: str = "Request timed out",
        timeout_seconds: float | None = None,
    ) -> None:
        self.timeout_seconds = timeout_seconds
        super().__init__(message)


def raise_for_status(status_code: int, response_data: dict[str, Any] | None = None) -> None:
    """Raise an appropriate exception for an HTTP status code.

    Args:
        status_code: HTTP status code.
        response_data: Parsed JSON response data.

    Raises:
        AuthenticationError: For 401 status.
        NotFoundError: For 404 status.
        ConflictError: For 409 status.
        ValidationError: For 422 status.
        RateLimitError: For 429 status.
        APIError: For other 4xx/5xx status codes.
    """
    if status_code < 400:
        return

    data = response_data or {}
    message = data.get("detail") or data.get("message") or data.get("error") or "Unknown error"
    details = data.get("details")

    if status_code == 401:
        raise AuthenticationError(message, details)
    elif status_code == 404:
        raise NotFoundError(resource=message, details=details)
    elif status_code == 409:
        raise ConflictError(message, details)
    elif status_code == 422:
        raise ValidationError(message, details=details)
    elif status_code == 429:
        retry_after = data.get("retry_after")
        raise RateLimitError(message, retry_after, details)
    else:
        raise APIError(status_code, message, details)
