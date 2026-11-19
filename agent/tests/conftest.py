"""Shared fixtures: build the app with an explicit fake Settings (no env reads)."""
import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.settings import Settings

FAKE_TOKEN = "test-internal-token"


@pytest.fixture()
def settings() -> Settings:
    return Settings(
        agent_internal_token=FAKE_TOKEN,
        ai_base_url="http://127.0.0.1:9/v1",
        ai_model="fake-model",
        ai_api_key="fake-key",
    )


@pytest.fixture()
def client(settings: Settings) -> TestClient:
    return TestClient(create_app(settings))
