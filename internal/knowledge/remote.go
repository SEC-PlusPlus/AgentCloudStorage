package knowledge

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// remoteAskPath 与 spec §4.1 内部契约逐字一致：POST {baseURL}/v1/ask。
const remoteAskPath = "/v1/ask"

// remoteAnswerBodyLimit 响应体读取上限 1MiB（Review Focus 5：io.LimitReader，非 MaxBytesReader——
// 后者是服务端语义；客户端用 LimitReader 截断，截断导致解码失败并映射到 ErrUpstreamLLM）。
const remoteAnswerBodyLimit = 1 << 20

// RemoteAnswerer 通过内部 HTTP 契约调用 Python agent 服务生成回答（spec §4.1/§5）。
type RemoteAnswerer struct {
	baseURL string
	apiKey  string
	client  *http.Client
}

// NewRemoteAnswerer 构造远端 Answerer；timeout 同时作为 http.Client.Timeout
// （transport 层超时，含超时映射为 ErrAgentUnavailable，见 spec §5）。
func NewRemoteAnswerer(baseURL, apiKey string, timeout time.Duration) *RemoteAnswerer {
	return &RemoteAnswerer{
		baseURL: baseURL,
		apiKey:  apiKey,
		client:  &http.Client{Timeout: timeout},
	}
}

// remoteAskRequest 字段名与 Python 侧 pydantic 模型逐字一致（spec §4.1）。
type remoteAskRequest struct {
	Question string `json:"question"`
	Source   string `json:"source"`
}

// remoteAskResponse 200 响应形如 {"answer": "..."}。
type remoteAskResponse struct {
	Answer string `json:"answer"`
}

func (a *RemoteAnswerer) Answer(ctx context.Context, question, source string) (string, error) {
	payload, err := json.Marshal(remoteAskRequest{Question: question, Source: source})
	if err != nil {
		// 两个 string 字段不可能编码失败；保留错误路径以防将来加字段。
		return "", fmt.Errorf("encode ask request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+remoteAskPath, bytes.NewReader(payload))
	if err != nil {
		return "", fmt.Errorf("build ask request: %w (%w)", ErrAgentUnavailable, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)

	resp, err := a.client.Do(req)
	if err != nil {
		// 传入 ctx 已取消/超时 → 裸返回 ctx.Err()，不包装（Task 9 composite 依赖此契约）。
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		// 其余 transport 错误（含 http.Client.Timeout 触发的超时）→ ErrAgentUnavailable。
		return "", fmt.Errorf("call agent service: %w (%w)", ErrAgentUnavailable, err)
	}
	defer resp.Body.Close()

	switch resp.StatusCode {
	case http.StatusOK:
		// 继续解析响应体。
	case http.StatusUnauthorized:
		return "", fmt.Errorf("agent rejected credentials: status %d (%w)", resp.StatusCode, ErrAgentUnauthorized)
	case http.StatusBadGateway, http.StatusGatewayTimeout:
		return "", fmt.Errorf("agent reports upstream llm failure: status %d (%w)", resp.StatusCode, ErrUpstreamLLM)
	default:
		// ≥500 其余、422/415 等其余 4xx 及其他非约定状态码 → ErrAgentUnavailable。
		return "", fmt.Errorf("unexpected agent status %d (%w)", resp.StatusCode, ErrAgentUnavailable)
	}

	var answer remoteAskResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, remoteAnswerBodyLimit)).Decode(&answer); err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", ctxErr
		}
		return "", fmt.Errorf("decode agent answer: %w (%w)", ErrUpstreamLLM, err)
	}
	trimmed := strings.TrimSpace(answer.Answer)
	if trimmed == "" {
		return "", fmt.Errorf("agent returned an empty answer: %w", ErrUpstreamLLM)
	}
	return trimmed, nil
}
