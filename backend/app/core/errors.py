from collections.abc import Sequence
from typing import Any

import structlog
from fastapi import FastAPI, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = structlog.get_logger()

_CODE_BY_STATUS = {
    400: "bad_request",
    401: "unauthorized",
    403: "forbidden",
    404: "not_found",
    409: "conflict",
    422: "validation_error",
    429: "rate_limited",
}


class CodedHTTPException(HTTPException):
    """An HTTPException with a specific machine-readable `code` in the error body, for
    cases the client must tell apart that share a status (e.g. the note editor treats a
    409 version conflict very differently from a 409 duplicate title)."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(status_code, message)
        self.code = code


def _error_response(status_code: int, code: str, message: str, details: Any = None) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message, "details": details}},
    )


def _serializable_errors(errors: Sequence[Any]) -> list[Any]:
    """A field validator that raises ValueError puts the exception object itself into the
    error's `ctx` — which JSONResponse can't serialize, turning a 422 into a 500."""
    cleaned = []
    for error in errors:
        error = dict(error)
        if "ctx" in error:
            error["ctx"] = {key: str(value) for key, value in error["ctx"].items()}
        cleaned.append(error)
    return jsonable_encoder(cleaned)


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        _request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        code = getattr(exc, "code", None) or _CODE_BY_STATUS.get(exc.status_code, "error")
        return _error_response(exc.status_code, code, str(exc.detail))

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        # A consistent JSON body the frontend can show, and no internals in the
        # response; the full traceback goes to the log.
        log.exception("api.unhandled_error", path=request.url.path, method=request.method)
        return _error_response(500, "internal_error", "Something went wrong on the server")

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        _request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return _error_response(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "validation_error",
            "Invalid request",
            _serializable_errors(exc.errors()),
        )
