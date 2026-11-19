"""Task 6: POST /v1/ask — internal answer contract (spec §4.1).

The upstream LLM is faked with httpx.MockTransport wrapped in a real AsyncOpenAI
client injected over app.state.llm_client, so tests exercise the genuine SDK
request/response encoding and its REAL exception types (no hand-rolled mocks that
could mask a mapping bug).
"""
import json
import re
from pathlib import Path

import httpx
from fastapi.testclient import TestClient
from openai import AsyncOpenAI

from app import prompts
from app.main import create_app
from app.settings import Settings

from tests.conftest import FAKE_TOKEN

AUTH = {"Authorization": f"Bearer {FAKE_TOKEN}"}
QUESTION = "报告里提到哪些风险？"
SOURCE = "[1] 第一季度营收增长。\n[2] 供应链存在中断风险。"
PAYLOAD = {"question": QUESTION, "source": SOURCE}


def completion(content: str | None = " 文本 ") -> dict:
    """Minimal OpenAI chat.completion body the SDK can parse."""
    return {
        "id": "chatcmpl-test",
        "object": "chat.completion",
        "created": 0,
        "model": "fake-model",
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": content},
                "finish_reason": "stop",
            }
        ],
    }


def ask_client(handler) -> tuple[TestClient, dict]:
    """App whose app.state.llm_client talks to a mock transport.

    handler(httpx.Request) -> httpx.Response (or raises httpx.X to simulate
    transport failures); every upstream call is recorded in the returned dict.
    """
    captured: dict = {"requests": []}
    settings = Settings(
        agent_internal_token=FAKE_TOKEN,
        ai_base_url="http://llm.invalid/v1",
        ai_model="fake-model",
        ai_api_key="fake-key",
    )
    app = create_app(settings)

    def h(request: httpx.Request) -> httpx.Response:
        captured["requests"].append(request)
        return handler(request)

    app.state.llm_client = AsyncOpenAI(
        base_url=settings.ai_base_url,
        api_key=settings.ai_api_key,
        http_client=httpx.AsyncClient(transport=httpx.MockTransport(h)),
        max_retries=0,
    )
    return TestClient(app), captured


def test_ask_success_and_payload_shape() -> None:
    client, captured = ask_client(lambda req: httpx.Response(200, json=completion()))
    r = client.post("/v1/ask", headers=AUTH, json=PAYLOAD)
    assert r.status_code == 200
    # contract: {"answer": ...}, upstream " 文本 " already stripped
    assert r.json() == {"answer": "文本"}

    assert len(captured["requests"]) == 1
    body = json.loads(captured["requests"][0].content)
    assert body["model"] == "fake-model"
    # system prompt byte-equal to prompts.SYSTEM_PROMPT (vs Go local.go is
    # checked separately below); user content is the fixed contract format
    assert body["messages"] == [
        {"role": "system", "content": prompts.SYSTEM_PROMPT},
        {"role": "user", "content": f"文件段落：\n{SOURCE}\n问题：{QUESTION}"},
    ]


def test_ask_422_on_limits() -> None:
    calls: list = []
    client, _ = ask_client(
        lambda req: (calls.append(req), httpx.Response(200, json=completion()))[1]
    )
    # question longer than 1000 chars -> 422
    r = client.post(
        "/v1/ask", headers=AUTH, json={"question": "问" * 1001, "source": SOURCE}
    )
    assert r.status_code == 422
    # source longer than 20000 chars -> 422
    r = client.post(
        "/v1/ask", headers=AUTH, json={"question": QUESTION, "source": "s" * 20001}
    )
    assert r.status_code == 422
    # pydantic rejects before any upstream LLM call is made
    assert calls == []


def test_ask_401_without_token() -> None:
    client, captured = ask_client(lambda req: httpx.Response(200, json=completion()))
    # missing Authorization header -> 401
    assert client.post("/v1/ask", json=PAYLOAD).status_code == 401
    # wrong token -> 401 as well
    r = client.post(
        "/v1/ask", headers={"Authorization": "Bearer not-the-token"}, json=PAYLOAD
    )
    assert r.status_code == 401
    # auth rejected before reaching the LLM
    assert captured["requests"] == []


def test_ask_502_on_empty_content() -> None:
    # empty / whitespace-only / missing content all go through UpstreamError -> 502
    for empty in ("", "   ", None):
        client, captured = ask_client(
            lambda req, c=empty: httpx.Response(200, json=completion(content=c))
        )
        r = client.post("/v1/ask", headers=AUTH, json=PAYLOAD)
        assert r.status_code == 502, f"content={empty!r} -> {r.status_code}"
        # upstream really was called (failure comes from parsing, not from 401/422)
        assert len(captured["requests"]) == 1


def test_ask_504_on_apitimeouterror() -> None:
    def raise_timeout(request: httpx.Request) -> httpx.Response:
        # the SDK translates httpx.TimeoutException subclasses into its REAL
        # APITimeoutError -> route must answer 504
        raise httpx.ReadTimeout("simulated read timeout", request=request)

    client, captured = ask_client(raise_timeout)
    r = client.post("/v1/ask", headers=AUTH, json=PAYLOAD)
    assert r.status_code == 504
    assert len(captured["requests"]) == 1


def test_ask_502_on_api_status_error() -> None:
    # upstream 4xx with an OpenAI-style error body -> real BadRequestError
    # (subclass of APIStatusError) -> 502
    client, _ = ask_client(
        lambda req: httpx.Response(
            400, json={"error": {"message": "bad request", "type": "invalid_request_error"}}
        )
    )
    assert client.post("/v1/ask", headers=AUTH, json=PAYLOAD).status_code == 502


def test_ask_502_on_api_connection_error() -> None:
    def raise_conn(request: httpx.Request) -> httpx.Response:
        # non-timeout transport failure -> real APIConnectionError -> 502
        raise httpx.ConnectError("simulated refused", request=request)

    client, _ = ask_client(raise_conn)
    assert client.post("/v1/ask", headers=AUTH, json=PAYLOAD).status_code == 502


def test_system_prompt_matches_go_local_verbatim() -> None:
    # spec R1: prompts.SYSTEM_PROMPT must stay byte-for-byte identical to
    # `localSystemPrompt` in internal/knowledge/local.go. Extract the Go string
    # literals (plain concatenation, no escapes in that constant) and compare
    # utf-8 bytes. Editing either side without the other fails this test.
    go_path = (
        Path(__file__).resolve().parents[2] / "internal" / "knowledge" / "local.go"
    )
    src = go_path.read_text(encoding="utf-8")
    m = re.search(r'const localSystemPrompt = ((?:"[^"]*"\s*\+?\s*)+)', src)
    assert m, "localSystemPrompt not found in local.go (renamed or reformatted?)"
    go_prompt = "".join(re.findall(r'"([^"]*)"', m.group(1)))
    assert prompts.SYSTEM_PROMPT.encode("utf-8") == go_prompt.encode("utf-8")


def test_create_app_wires_llm_client_without_retries() -> None:
    # create_app must populate app.state.llm_client from settings, and keep
    # Review Focus 1: max_retries=0 so ONE llm_timeout (45s default) attempt
    # always finishes (504) before Go's 60s client timeout — SDK retries would
    # stack attempts past the Go deadline.
    settings = Settings(
        agent_internal_token=FAKE_TOKEN,
        ai_base_url="http://127.0.0.1:9/v1",
        ai_model="fake-model",
        ai_api_key="fake-key",
    )
    app = create_app(settings)
    client = app.state.llm_client
    assert isinstance(client, AsyncOpenAI)
    assert str(client.base_url).rstrip("/") == settings.ai_base_url
    assert client.api_key == settings.ai_api_key
    # the SDK stores the timeout as given (float seconds; httpx wraps it per-request)
    assert client.timeout == settings.llm_timeout
    assert client.max_retries == 0
