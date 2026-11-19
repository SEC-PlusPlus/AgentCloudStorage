"""Task 5 skeleton: healthz is open, protected routes demand the exact bearer token,
and the llm_timeout default is pinned at 45s (timeout-chain invariant)."""
from app.settings import Settings

from tests.conftest import FAKE_TOKEN


def test_healthz_open(client) -> None:
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


def test_protected_requires_exact_bearer(client) -> None:
    # missing header -> 401
    assert client.get("/_auth_probe").status_code == 401
    # wrong token -> 401
    r = client.get("/_auth_probe", headers={"Authorization": "Bearer not-the-token"})
    assert r.status_code == 401
    # exact token -> passes
    r = client.get("/_auth_probe", headers={"Authorization": f"Bearer {FAKE_TOKEN}"})
    assert r.status_code == 200


def test_llm_timeout_default_is_45() -> None:
    # Review Focus 1 (timeout inversion): the LLM timeout must stay strictly below the
    # Go-side agent.timeout default of 60s, so Python answers 504 before Go hangs up on
    # an already-billed LLM call. If you change this, change Go's default too (and think).
    assert Settings.model_fields["llm_timeout"].default == 45.0
