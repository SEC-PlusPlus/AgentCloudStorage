"""POST /v1/ask — the internal answering endpoint the Go backend calls.

Contract (spec §4.1, mirrors internal/knowledge/remote.go):
  request  {"question": <=1000 chars, "source": <=20000 chars}
  200      {"answer": "<LLM text, stripped>"}
  401      missing/wrong bearer token (require_internal_token, router-level)
  422      limit violation (AskRequest, before any LLM call)
  504      LLM request timed out (APITimeoutError)
  502      any other upstream LLM failure (APIStatusError / APIConnectionError
           / UpstreamError for empty content)
Go maps 401 -> ErrAgentUnauthorized and 502/504 -> ErrUpstreamLLM; nothing on
the Go side inspects these bodies, only the status codes.

POST /v1/ask/stream (Task 10, frame format FROZEN — Go Task 11 passes these
bytes through to the browser verbatim):
  per delta     data: {"delta": "<string>"}\n\n  (json.dumps ensure_ascii=False)
  normal end    data: [DONE]\n\n
  mid-stream
  upstream fail data: {"error": "upstream llm failure"}\n\n  then close, NO
                [DONE] (the stream already answered 200, so status codes are
                off the table from the first yielded byte onward)
  headers       content-type text/event-stream; charset=utf-8,
                Cache-Control: no-cache, X-Accel-Buffering: no
Failures BEFORE the stream starts keep plain JSON status codes identical to
/v1/ask: the route awaits create(stream=True) — the upstream request/response
headers exchange happens there — before returning a StreamingResponse, so
401/422 (FastAPI deps/validation) and 502/504 (transport/API errors) never
arrive as SSE.
Cancellation safety (Review Focus 3): sse_frames' finally closes the SDK
stream on EVERY termination path — normal end, mid-stream APIError, and
GeneratorExit/CancelledError when a disconnecting client makes Starlette
close the response body iterator. Without it the upstream HTTP connection
would linger until async-generator garbage collection.
"""
import json
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from openai import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    APIStatusError,
    AsyncOpenAI,
    AsyncStream,
)
from openai.types.chat import ChatCompletionChunk

from .prompts import build_messages
from .schemas import AskRequest
from .security import require_internal_token


class UpstreamError(RuntimeError):
    """The LLM call itself failed to produce usable content (-> 502)."""


router = APIRouter(dependencies=[Depends(require_internal_token)])


async def answer_question(
    client: AsyncOpenAI, model: str, question: str, source: str
) -> str:
    """One chat completion against the configured model; returns stripped text.

    Raises UpstreamError on empty/missing content (mirrors LocalAnswerer's
    trim-and-check-empty in Go), APITimeoutError/APIConnectionError/
    APIStatusError are the SDK's own and get translated by the route.
    """
    resp = await client.chat.completions.create(
        model=model,
        messages=build_messages(question, source),
    )
    if not resp.choices:
        raise UpstreamError("upstream returned no choices")
    content = resp.choices[0].message.content
    if content is None or not content.strip():
        raise UpstreamError("model returned an empty answer")
    return content.strip()


@router.post("/v1/ask")
async def ask(payload: AskRequest, request: Request) -> dict:
    settings = request.app.state.settings
    try:
        answer = await answer_question(
            request.app.state.llm_client,
            settings.ai_model,
            payload.question,
            payload.source,
        )
    except APITimeoutError as exc:
        # APITimeoutError subclasses APIConnectionError — this clause MUST stay
        # first or timeouts would answer 502 instead of 504.
        raise HTTPException(status_code=504, detail="llm request timed out") from exc
    except (APIStatusError, APIConnectionError, UpstreamError) as exc:
        raise HTTPException(status_code=502, detail="llm upstream failure") from exc
    return {"answer": answer}


def _sse(payload: dict) -> str:
    """One frozen SSE data frame: json.dumps with ensure_ascii=False (CJK
    deltas stay literal UTF-8; Go Task 11 byte-scans these lines)."""
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


# module-level constants so the frame bytes can never drift per-request
DONE_FRAME = "data: [DONE]\n\n"
ERROR_FRAME = _sse({"error": "upstream llm failure"})


async def sse_frames(
    stream: AsyncStream[ChatCompletionChunk],
) -> AsyncIterator[str]:
    """Translate an openai chunk stream into the frozen SSE frame sequence.

    Yielded per content delta from choices[0].delta.content; role-only deltas
    (content None) and empty-choices chunks (usage tail) are skipped. The
    finally MUST run on every termination path: the SDK's own close-on-
    exhaustion only fires when its generator unwinds, but on a client
    disconnect Starlette can close us while the SDK stream is merely *parked*
    between deltas — only `await stream.close()` here releases that upstream
    connection (pinned by
    tests/test_ask_stream.py::test_stream_disconnect_closes_upstream).
    """
    try:
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            content = delta.content if delta is not None else None
            if content:
                yield _sse({"delta": content})
        yield DONE_FRAME
    except APIError:
        # APIError is the base of APIStatusError / APIConnectionError (and its
        # APITimeoutError subclass) / APIResponseValidationError: any SDK-side
        # failure raised mid-iteration becomes the contract error frame. We do
        # NOT append [DONE] after it — the answer is truncated, Go must know.
        yield ERROR_FRAME
    finally:
        # Normal end, error, GeneratorExit (client disconnect) and even
        # cancellation all pass through here. close() is idempotent, so the
        # SDK's own end-of-stream close is never a problem.
        await stream.close()


SSE_RESPONSE_HEADERS = {
    # no-cache: proxies must not cache/reorder the stream; X-Accel-Buffering
    # disables nginx response buffering so frames flush per-delta.
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
}


@router.post("/v1/ask/stream")
async def ask_stream(payload: AskRequest, request: Request) -> StreamingResponse:
    settings = request.app.state.settings
    # Await BEFORE streaming: the upstream request goes out and its response
    # headers/status are validated here, so pre-stream failures (timeout ->
    # 504, connect/status -> 502) stay plain JSON like /v1/ask. Only once we
    # hold an AsyncStream do we hand over to SSE, after which the contract is
    # frames-only and failures degrade to the error frame.
    try:
        stream = await request.app.state.llm_client.chat.completions.create(
            model=settings.ai_model,
            messages=build_messages(payload.question, payload.source),
            stream=True,
        )
    except APITimeoutError as exc:
        # APITimeoutError subclasses APIConnectionError — must stay first
        # (same ordering invariant as ask() above, mirrored deliberately).
        raise HTTPException(status_code=504, detail="llm request timed out") from exc
    except (APIStatusError, APIConnectionError) as exc:
        raise HTTPException(status_code=502, detail="llm upstream failure") from exc
    return StreamingResponse(
        sse_frames(stream),
        # Starlette appends "; charset=utf-8" to text/* media types
        # (responses.init_headers), producing the exact frozen header value.
        media_type="text/event-stream",
        headers=SSE_RESPONSE_HEADERS,
    )
