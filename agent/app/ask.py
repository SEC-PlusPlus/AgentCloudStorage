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
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from openai import APITimeoutError, APIConnectionError, APIStatusError, AsyncOpenAI

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
