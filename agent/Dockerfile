# Agent service image. Build context is the REPO ROOT (app code lives under
# agent/):  docker build -f agent/Dockerfile -t agentcloud-agent .
# Run/dev instructions: agent/README.md; prod deploy topology: spec §7.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Layer deps first so code edits don't bust the pip cache.
COPY agent/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY agent/app ./app

# Non-root runtime user.
RUN useradd --create-home --shell /usr/sbin/nologin agent
USER agent

# Build-time smoke: module must import with ZERO env set (no module-level
# app instance; Settings() is only built inside the factory at request start).
RUN python -c "import app.main; print('build smoke: import app.main OK')"

# slim has no curl/wget, so probe /healthz with the stdlib.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8001/healthz',timeout=2).status==200 else 1)"

EXPOSE 8001

# Factory mode (see app/main.py docstring): uvicorn calls create_app() after
# the container env (AGENT_INTERNAL_TOKEN etc.) exists. 0.0.0.0 INSIDE the
# container is correct — isolation comes from publish-time binding
# (127.0.0.1 host mapping in compose, spec §7), the image stays bind-agnostic.
CMD ["uvicorn", "--factory", "app.main:create_app", "--host", "0.0.0.0", "--port", "8001"]
