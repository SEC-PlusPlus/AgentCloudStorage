"""Env-driven configuration for the agent service.

Each field maps to the same-named uppercase environment variable
(AGENT_INTERNAL_TOKEN, AI_BASE_URL, AI_MODEL, AI_API_KEY, LLM_TIMEOUT).
AGENT_INTERNAL_TOKEN must equal the Go backend's AGENT_API_KEY (same value,
both sides; spec §4.1). Tests construct Settings(...) directly with fake
values instead of touching the environment.
"""
from pydantic import Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # min_length=1 on all four required fields (controller ruling, same
    # fail-loud class): an env var set but empty (AGENT_INTERNAL_TOKEN=) must
    # raise ValidationError at Settings() construction, never silently accept
    # a bare "Bearer " header or send an empty LLM key upstream.
    # Pinned by tests/test_settings_validation.py.
    agent_internal_token: str = Field(min_length=1)
    ai_base_url: str = Field(min_length=1)
    ai_model: str = Field(min_length=1)
    ai_api_key: str = Field(min_length=1)
    # Review Focus 1 (timeout inversion): this default must stay strictly below the
    # Go-side agent.timeout default of 60s, so the agent returns 504 before Go hangs up
    # on an LLM call that is already billed. Pinned by
    # tests/test_health_auth.py::test_llm_timeout_default_is_45.
    llm_timeout: float = 45.0
