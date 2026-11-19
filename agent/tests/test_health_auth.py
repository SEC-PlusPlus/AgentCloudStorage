"""Task 5 skeleton + Task 6 route: healthz is open, /v1/ask demands the exact
bearer token, and the llm_timeout default is pinned at 45s (timeout-chain
invariant). The Task 5 `/_auth_probe` route is gone; these auth regressions now
run against the real protected endpoint (the exact-token *passes* branch is
covered by tests/test_ask.py::test_ask_success_and_payload_shape)."""
from app.settings import Settings

from tests.conftest import FAKE_TOKEN

ASK_BODY = {"question": "q", "source": "s"}


def test_healthz_open(client) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_protected_requires_exact_bearer(client) -> None:
    # missing header -> 401 (rejected before the LLM slot is ever touched)
    assert client.post("/v1/ask", json=ASK_BODY).status_code == 401
    # wrong token -> 401
    r = client.post(
        "/v1/ask", headers={"Authorization": "Bearer not-the-token"}, json=ASK_BODY
    )
    assert r.status_code == 401


def test_non_ascii_bearer_header_is_401_not_500(client) -> None:
    # Send raw bytes (httpx refuses non-ASCII str header values): Starlette decodes
    # headers latin-1, so byte >= 0x80 arrives as a non-ASCII str and the old
    # hmac.compare_digest(str, str) raised TypeError -> 500. Byte-wise compare makes
    # every wrong token, weird or not, a 401.
    r = client.post("/v1/ask", headers={"Authorization": b"Bearer caf\xc3\xa9"}, json=ASK_BODY)
    assert r.status_code == 401


def test_llm_timeout_default_is_45() -> None:
    # Review Focus 1 (timeout inversion): the LLM timeout must stay strictly below the
    # Go-side agent.timeout default of 60s, so Python answers 504 before Go hangs up on
    # an already-billed LLM call. If you change this, change Go's default too (and think).
    assert Settings.model_fields["llm_timeout"].default == 45.0
