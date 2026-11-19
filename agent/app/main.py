"""FastAPI app factory for the agent service (skeleton, Task 5).

create_app() falls back to env-driven Settings() in production; tests inject a
constructed Settings. No module-level app instance here yet — Task 7 adds
`app = create_app()` once Docker/docs land.
"""
from fastapi import Depends, FastAPI

from .security import require_internal_token
from .settings import Settings


def create_app(settings: Settings | None = None) -> FastAPI:
    if settings is None:
        settings = Settings()
    app = FastAPI(title="pcs-agent", docs_url=None, redoc_url=None)
    app.state.settings = settings
    # Task 6 populates this with an AsyncOpenAI client; the slot exists now so
    # routes and tests can rely on app.state.llm_client always being present.
    app.state.llm_client = None

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"status": "ok"}

    # Temporary probe route pinning bearer behaviour until /v1/ask exists;
    # Task 6 removes it (the real contract has its own auth tests).
    @app.get("/_auth_probe", dependencies=[Depends(require_internal_token)])
    async def auth_probe() -> dict:
        return {"status": "ok"}

    return app
