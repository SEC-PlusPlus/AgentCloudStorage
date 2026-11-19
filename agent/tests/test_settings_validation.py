"""Fail-closed settings validation (IMPORTANT finding: empty-token fail-open).

An env var that is *set but empty* (AGENT_INTERNAL_TOKEN=, AI_API_KEY=, ...)
must raise pydantic ValidationError at Settings() construction instead of
yielding an empty string that the app would silently accept (bare "Bearer "
matching, empty upstream key). All four required fields carry
Field(min_length=1); pinned here.
"""
import pytest
from pydantic import ValidationError

from app.settings import Settings


def _full_kwargs() -> dict:
    return {
        "agent_internal_token": "t",
        "ai_base_url": "http://127.0.0.1:9/v1",
        "ai_model": "m",
        "ai_api_key": "k",
    }


def test_empty_agent_internal_token_rejected() -> None:
    kwargs = _full_kwargs()
    kwargs["agent_internal_token"] = ""
    with pytest.raises(ValidationError):
        Settings(**kwargs)


def test_empty_ai_api_key_rejected() -> None:
    kwargs = _full_kwargs()
    kwargs["ai_api_key"] = ""
    with pytest.raises(ValidationError):
        Settings(**kwargs)


@pytest.mark.parametrize(
    "field",
    ["agent_internal_token", "ai_base_url", "ai_model", "ai_api_key"],
)
def test_each_required_field_empty_rejected(field: str) -> None:
    kwargs = _full_kwargs()
    kwargs[field] = ""
    with pytest.raises(ValidationError):
        Settings(**kwargs)


def test_non_empty_settings_still_constructs() -> None:
    s = Settings(**_full_kwargs())
    assert s.agent_internal_token == "t"
    assert s.llm_timeout == 45.0  # untouched default still available
