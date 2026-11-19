"""Task 10: POST /v1/ask/stream — SSE streaming contract (frozen for Go Task 11).

Frames, byte-for-byte:
  per delta      data: {"delta": "<string>"}\n\n   (json.dumps, ensure_ascii=False)
  normal end     data: [DONE]\n\n
  mid-stream
  upstream fail  data: {"error": "upstream llm failure"}\n\n   (NO [DONE])
Headers: text/event-stream; charset=utf-8, Cache-Control: no-cache,
X-Accel-Buffering: no. Pre-start failures (401/422/transport) stay plain JSON.

Upstream is the real openai SDK over httpx.MockTransport (same discipline as
tests/test_ask.py), so SSE decoding and the real API* exception types are
exercised end-to-end. Cancellation (Review Focus 3) is pinned twice:
- test_stream_disconnect_closes_upstream drives the route generator directly
  and closes it while the SDK stream is parked between deltas: ONLY the
  generator's `finally: await stream.close()` can flip the upstream closed
  flag there (the SDK's own finally would need the generator to unwind, which
  never happens while it sits parked at its yield). Remove the finally, fail.
- test_stream_asgi_disconnect_closes_upstream runs the full ASGI stack with a
  hand-rolled receive/send that delivers http.disconnect right after the first
  frame (httpx's ASGITransport buffers the whole response, so it cannot model
  a streaming client disconnect; TestClient likewise only returns once the app
  task has finished, which a hung-up stream never reaches).
"""
import json
from typing import AsyncIterator

import anyio
import httpx
from fastapi.testclient import TestClient
from openai import AsyncOpenAI

from app.ask import sse_frames
from app.main import create_app
from app.prompts import build_messages
from app.settings import Settings

from tests.conftest import FAKE_TOKEN

AUTH = {"Authorization": f"Bearer {FAKE_TOKEN}"}
QUESTION = "报告里提到哪些风险？"
SOURCE = "[1] 第一季度营收增长。\n[2] 供应链存在中断风险。"
PAYLOAD = {"question": QUESTION, "source": SOURCE}


def sse(
    content: str | None = None, finish: str | None = None, role: str | None = None
) -> bytes:
    """OpenAI chat.completion.chunk SSE event; parseable by the real SDK.

    content=None emits a delta without a content key (role-only first chunk);
    the route must not produce a frame for it.
    """
    delta: dict = {}
    if role is not None:
        delta["role"] = role
    if content is not None:
        delta["content"] = content
    payload = {
        "id": "chatcmpl-stream",
        "object": "chat.completion.chunk",
        "created": 0,
        "model": "fake-model",
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
    }
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n".encode("utf-8")


DONE_EVENT = b"data: [DONE]\n\n"

STREAM_HEADERS = {"content-type": "text/event-stream"}


def stream_app(handler):
    """create_app() with a mock-transport-backed AsyncOpenAI, like ask_client.

    Returns (app, captured); handler(httpx.Request) -> httpx.Response may also
    raise httpx.X to simulate transport failures. The raw app is returned (not
    a TestClient) because the disconnect tests drive ASGI messages directly.
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
    return app, captured


class BlockingStream(httpx.AsyncByteStream):
    """Upstream body: one SSE event ready, then blocks forever on the next.

    closed flips ONLY in aclose() — what a real connection release does on
    server-side disconnect. It deliberately has no __aiter__ finally, so
    neither GC nor plain exception unwinding of the generator can fake it.
    """

    def __init__(self) -> None:
        self.closed = False

    async def __aiter__(self) -> AsyncIterator[bytes]:
        yield sse(content="第一帧")
        await anyio.sleep(3600)
        yield sse(content="第二帧")

    async def aclose(self) -> None:
        self.closed = True


def test_stream_frames_and_headers() -> None:
    body = b"".join(
        [
            sse(role="assistant"),  # delta without content -> no frame
            sse(content="你好"),
            sse(content="，世界"),
            sse(content="！", finish="stop"),
            DONE_EVENT,
        ]
    )
    app, captured = stream_app(
        lambda req: httpx.Response(200, content=body, headers=STREAM_HEADERS)
    )
    r = TestClient(app).post("/v1/ask/stream", headers=AUTH, json=PAYLOAD)
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/event-stream; charset=utf-8"
    assert r.headers["cache-control"] == "no-cache"
    assert r.headers["x-accel-buffering"] == "no"
    # frozen frame bytes, in order, UTF-8 unescaped
    assert r.text == (
        'data: {"delta": "你好"}\n\n'
        'data: {"delta": "，世界"}\n\n'
        'data: {"delta": "！"}\n\n'
        "data: [DONE]\n\n"
    )
    sent = json.loads(captured["requests"][0].content)
    assert sent["stream"] is True
    assert sent["model"] == "fake-model"
    assert sent["messages"] == build_messages(QUESTION, SOURCE)


def test_stream_422_and_401_plain_json() -> None:
    app, captured = stream_app(
        lambda req: httpx.Response(200, content=DONE_EVENT, headers=STREAM_HEADERS)
    )
    client = TestClient(app)
    # same AskRequest limits as /v1/ask -> 422 JSON, never event-stream
    r = client.post(
        "/v1/ask/stream", headers=AUTH, json={"question": "问" * 1001, "source": SOURCE}
    )
    assert r.status_code == 422
    assert r.headers["content-type"] == "application/json"
    r = client.post(
        "/v1/ask/stream", headers=AUTH, json={"question": QUESTION, "source": "s" * 20001}
    )
    assert r.status_code == 422
    # missing / wrong bearer -> 401 JSON
    assert client.post("/v1/ask/stream", json=PAYLOAD).status_code == 401
    r = client.post(
        "/v1/ask/stream", headers={"Authorization": "Bearer nope"}, json=PAYLOAD
    )
    assert r.status_code == 401
    # rejected before an upstream stream is ever opened
    assert captured["requests"] == []


def test_stream_mid_failure_emits_error_frame_without_done() -> None:
    async def broken_body() -> AsyncIterator[bytes]:
        yield sse(content="部分答案")
        # headers arrived (stream started), then the read times out: the SDK
        # surfaces this as APITimeoutError during iteration
        raise httpx.ReadTimeout("mid-stream read timeout")

    app, _ = stream_app(
        lambda req: httpx.Response(200, content=broken_body(), headers=STREAM_HEADERS)
    )
    r = TestClient(app).post("/v1/ask/stream", headers=AUTH, json=PAYLOAD)
    assert r.status_code == 200  # stream already started: must stay 200
    assert r.headers["content-type"] == "text/event-stream; charset=utf-8"
    assert r.text == (
        'data: {"delta": "部分答案"}\n\n'
        'data: {"error": "upstream llm failure"}\n\n'
    )
    assert "[DONE]" not in r.text


def test_stream_prestart_errors_plain_json() -> None:
    # transport cannot connect (before any byte of the SSE stream): 502 JSON
    def conn_fail(req: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    app, _ = stream_app(conn_fail)
    r = TestClient(app).post("/v1/ask/stream", headers=AUTH, json=PAYLOAD)
    assert r.status_code == 502
    assert r.headers["content-type"] == "application/json"

    # no response headers in time: 504 JSON (APITimeoutError leg, same as /v1/ask)
    def timeout_fail(req: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("no headers in time")

    app, _ = stream_app(timeout_fail)
    r = TestClient(app).post("/v1/ask/stream", headers=AUTH, json=PAYLOAD)
    assert r.status_code == 504
    assert r.headers["content-type"] == "application/json"


def test_stream_disconnect_closes_upstream() -> None:
    # Review Focus 3, GeneratorExit leg (isolated proof of the finally): the
    # SDK stream is parked between deltas (BlockingStream in its sleep), so
    # nothing but OUR `finally: await stream.close()` can reach the upstream
    # aclose. Delete the finally from sse_frames and the last assert fails.
    upstream = BlockingStream()
    app, _ = stream_app(lambda req: httpx.Response(200, stream=upstream))
    llm_client = app.state.llm_client

    async def drive() -> None:
        stream = await llm_client.chat.completions.create(
            model="fake-model",
            messages=build_messages(QUESTION, SOURCE),
            stream=True,
        )
        frames = sse_frames(stream)
        first = await frames.__anext__()
        assert first == 'data: {"delta": "第一帧"}\n\n'
        assert upstream.closed is False  # nothing closed while parked
        await frames.aclose()  # simulate Starlette closing on client disconnect
        assert upstream.closed is True  # our finally ran

    anyio.run(drive)
    # the normal end-of-stream leg needs the same finally to be SAFE (not just
    # present): on a full read httpx already closed the response, and close()
    # again must not explode. test_stream_frames_and_headers proves that
    # end-to-end through the route (the request completes with [DONE]).


def test_stream_asgi_disconnect_closes_upstream() -> None:
    # Full-stack disconnect leg: drive the real ASGI app with a hand-rolled
    # receive/send. The first non-empty data frame is "received by the
    # browser"; we then answer Starlette's listen_for_disconnect with
    # http.disconnect while the upstream blocks on its next delta, and assert
    # the app call unwinds with the upstream released (closed flag).
    upstream = BlockingStream()
    app, _ = stream_app(lambda req: httpx.Response(200, stream=upstream))

    messages: list[dict] = []
    hangup = anyio.Event()
    request_body = json.dumps(PAYLOAD).encode("utf-8")
    body_delivered = False

    async def receive() -> dict:
        nonlocal body_delivered
        if not body_delivered:
            body_delivered = True
            return {"type": "http.request", "body": request_body, "more_body": False}
        await hangup.wait()
        return {"type": "http.disconnect"}

    async def send(message: dict) -> None:
        messages.append(message)
        if (
            message["type"] == "http.response.body"
            and message.get("body")
            and not hangup.is_set()
        ):
            hangup.set()  # browser closes the tab as soon as frame 1 lands

    scope = {
        "type": "http",
        "asgi": {"version": "3.0", "spec_version": "2.3"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/v1/ask/stream",
        "raw_path": b"/v1/ask/stream",
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"testserver"),
            (b"content-type", b"application/json"),
            (b"authorization", f"Bearer {FAKE_TOKEN}".encode("ascii")),
        ],
        "client": ("127.0.0.1", 12345),
        "server": ("testserver", 80),
    }

    async def drive() -> None:
        with anyio.fail_after(10):
            await app(scope, receive, send)

    anyio.run(drive)  # returns once the response generator has fully unwound

    start = [m for m in messages if m["type"] == "http.response.start"]
    assert start and start[0]["status"] == 200
    frames = b"".join(
        m.get("body", b"") for m in messages if m["type"] == "http.response.body"
    )
    assert frames == 'data: {"delta": "第一帧"}\n\n'.encode("utf-8")
    assert upstream.closed is True  # released before the app call returned,
    # i.e. deterministically by the unwinding generator, not by GC
