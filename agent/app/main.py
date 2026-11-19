"""FastAPI app factory for the agent service.

create_app() falls back to env-driven Settings() in production; tests inject a
constructed Settings and may override app.state.llm_client with an
AsyncOpenAI(http_client=httpx.AsyncClient(transport=httpx.MockTransport(...)))
to fake the upstream LLM. No module-level app instance here yet — Task 7 adds
`app = create_app()` once Docker/docs land.
"""
from fastapi import FastAPI
from openai import AsyncOpenAI

from .ask import router as ask_router
from .settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    if settings is None:
        settings = Settings()
    app = FastAPI(title="pcs-agent", docs_url=None, redoc_url=None)
    app.state.settings = settings
    app.state.llm_client = AsyncOpenAI(
        base_url=settings.ai_base_url,
        api_key=settings.ai_api_key,
        timeout=settings.llm_timeout,
        # Review Focus 1 (timeout inversion): max_retries=0 keeps exactly ONE
        # llm_timeout-length attempt in flight, so /v1/ask answers 504 inside
        # 45s — strictly below Go's 60s client timeout. SDK retries would stack
        # attempts past the Go deadline on an already-billed call. Pinned by
        # tests/test_ask.py::test_create_app_wires_llm_client_without_retries.
        max_retries=0,
    )

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"status": "ok"}

    app.include_router(ask_router)

    return app
