"""Internal-auth dependency: Authorization: Bearer <AGENT_INTERNAL_TOKEN>.

Compared with hmac.compare_digest over the full header value (plan Global
Constraints). Missing or mismatched header -> 401; the Go composite answerer
treats 401 as a config error, not a transient failure (Review Focus 4).
Operands are utf-8 encoded before comparison: compare_digest raises TypeError
(non-ASCII str), and Starlette headers are latin-1 decoded.
"""
import hmac

from fastapi import Header, HTTPException, Request


async def require_internal_token(
    request: Request,
    authorization: str | None = Header(default=None),
) -> None:
    expected = f"Bearer {request.app.state.settings.agent_internal_token}"
    # Compare bytes: hmac.compare_digest raises TypeError on non-ASCII *str* operands,
    # and Starlette decodes headers latin-1 (so any byte >= 0x80 would crash a str
    # compare with 500 instead of 401). utf-8 encoding is injective on str, so
    # equality semantics are unchanged.
    if authorization is None or not hmac.compare_digest(
        authorization.encode("utf-8"), expected.encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail="invalid internal token")
