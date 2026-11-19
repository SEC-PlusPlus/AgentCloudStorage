"""Internal-auth dependency: Authorization: Bearer <AGENT_INTERNAL_TOKEN>.

Compared with hmac.compare_digest over the full header value (plan Global
Constraints). Missing or mismatched header -> 401; the Go composite answerer
treats 401 as a config error, not a transient failure (Review Focus 4).
"""
import hmac

from fastapi import Header, HTTPException, Request


async def require_internal_token(
    request: Request,
    authorization: str | None = Header(default=None),
) -> None:
    expected = f"Bearer {request.app.state.settings.agent_internal_token}"
    if authorization is None or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="invalid internal token")
