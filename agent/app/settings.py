"""Env-driven configuration for the agent service.

Each field maps to the same-named uppercase environment variable
(AGENT_INTERNAL_TOKEN, AI_BASE_URL, AI_MODEL, AI_API_KEY, LLM_TIMEOUT).
AGENT_INTERNAL_TOKEN must equal the Go backend's AGENT_API_KEY (same value,
both sides; spec §4.1). Tests construct Settings(...) directly with fake
values instead of touching the environment.
"""
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    agent_internal_token: str
    ai_base_url: str
    ai_model: str
    ai_api_key: str
    # Review Focus 1 (timeout inversion): this default must stay strictly below the
    # Go-side agent.timeout default of 60s, so the agent returns 504 before Go hangs up
    # on an LLM call that is already billed. Pinned by
    # tests/test_health_auth.py::test_llm_timeout_default_is_45.
    llm_timeout: float = 45.0
