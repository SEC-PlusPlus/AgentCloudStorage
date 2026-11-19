package knowledge

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
)

// remoteAskPath 与 spec §4.1 内部契约逐字一致：POST {baseURL}/v1/ask。
const remoteAskPath = "/v1/ask"

// remoteAskStreamPath 与 Task 10 冻结契约逐字一致：POST {baseURL}/v1/ask/stream。
const remoteAskStreamPath = "/v1/ask/stream"

// remoteAnswerBodyLimit 响应体读取上限 1MiB（Review Focus 5：io.LimitReader，非 MaxBytesReader——
// 后者是服务端语义；客户端用 LimitReader 截断，截断导致解码失败并映射到 ErrUpstreamLLM）。
const remoteAnswerBodyLimit = 1 << 20

// Task 11 SSE 解析上限：
//   - 单帧行 ≤64KiB（bufio.Scanner 行缓冲；畸形/超宽帧=协议违规→Warn 关流）；
//   - 全流累计 ≤4MiB（Review Focus 5：超限 Warn 关流）。LimitReader 再放一行宽余量，
//     保证越限由"计数"上报，而不是被 LimitReader 的静默 EOF 吞掉。
const (
	remoteStreamMaxLineBytes  = 64 << 10
	remoteStreamMaxTotalBytes = 4 << 20
)

// sseDataPrefix / sseDonePayload：Task 10 冻结线上格式的行级常量。
var (
	sseDataPrefix  = []byte("data: ")
	sseDonePayload = []byte("[DONE]")
)

// agentStatusError 是 Task 3 状态→哨兵映射的唯一实现，Answer 与 StreamAnswer 共用
// （同一张表，绝不复制第二份）。错误文案保持原样。
func agentStatusError(status int) error {
	switch status {
	case http.StatusUnauthorized:
		return fmt.Errorf("agent rejected credentials: status %d (%w)", status, ErrAgentUnauthorized)
	case http.StatusBadGateway, http.StatusGatewayTimeout:
		return fmt.Errorf("agent reports upstream llm failure: status %d (%w)", status, ErrUpstreamLLM)
	default:
		// ≥500 其余、422/415 等其余 4xx 及其他非约定状态码 → ErrAgentUnavailable。
		return fmt.Errorf("unexpected agent status %d (%w)", status, ErrAgentUnavailable)
	}
}

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

	if resp.StatusCode != http.StatusOK {
		return "", agentStatusError(resp.StatusCode)
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

// remoteStreamFrame 对应 Task 10 冻结的两种载荷：{"delta": "..."} 与 {"error": "..."}。
// [DONE] 不是 JSON，在行级先行短路，不会走到这里。
type remoteStreamFrame struct {
	Delta string `json:"delta"`
	Error string `json:"error"`
}

// StreamAnswer 调 {baseURL}/v1/ask/stream 并把 delta 帧逐条送入通道（Task 11）。
// 请求头/认证/ctx 纪律与 Answer 完全一致；非 200 走同一张 agentStatusError 表同步返回。
// 200 之后一切流内异常（错误帧、超行/超总字节、畸形帧、截断、取消）只记 slog，
// 通道以 close 收尾——绝不向调用方发明错误。
func (a *RemoteAnswerer) StreamAnswer(ctx context.Context, question, source string) (<-chan string, error) {
	payload, err := json.Marshal(remoteAskRequest{Question: question, Source: source})
	if err != nil {
		return nil, fmt.Errorf("encode ask stream request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, a.baseURL+remoteAskStreamPath, bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("build ask stream request: %w (%w)", ErrAgentUnavailable, err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+a.apiKey)

	resp, err := a.client.Do(req)
	if err != nil {
		// 与 Answer 同一 ctx 契约：调用方 ctx 已死 → 裸返回 ctx.Err()（Task 9 回落门依赖）。
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		return nil, fmt.Errorf("call agent stream: %w (%w)", ErrAgentUnavailable, err)
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		io.Copy(io.Discard, io.LimitReader(resp.Body, 4<<10)) // 少量排空利于连接复用
		return nil, agentStatusError(resp.StatusCode)
	}

	out := make(chan string, streamChanBuffer)
	go consumeAgentStream(ctx, resp.Body, out)
	return out, nil
}

// consumeAgentStream 逐行解析 SSE（bufio.Scanner，行上限 64KiB），把 delta 送进 out。
// 任何终结路径都 close(out) 并关闭 body：正常 [DONE]、错误帧、字节超限、Scanner 报错、
// ctx 取消、EOF 截断。body 由调用方在 200 后交棒至此，所有权在此收口。
func consumeAgentStream(ctx context.Context, body io.ReadCloser, out chan<- string) {
	defer body.Close()
	defer close(out)

	// 硬顶=累计上限+一行宽余量（见 remoteStreamMaxLineBytes 注释）。
	scanner := bufio.NewScanner(io.LimitReader(body, remoteStreamMaxTotalBytes+remoteStreamMaxLineBytes))
	scanner.Buffer(nil, remoteStreamMaxLineBytes)

	total := 0
	for scanner.Scan() {
		line := scanner.Bytes()
		total += len(line) + 1 // +换行符；近似即可，宁早勿晚
		if total > remoteStreamMaxTotalBytes {
			slog.Warn("agent stream exceeded total byte cap", "bytes", total)
			return
		}
		if len(line) == 0 {
			continue // 帧间空行（\n\n 的第二个换行）
		}
		if !bytes.HasPrefix(line, sseDataPrefix) {
			slog.Warn("agent stream skipped non-data line", "line", previewBytes(line))
			continue
		}
		data := line[len(sseDataPrefix):]
		if bytes.Equal(data, sseDonePayload) {
			return // 正常收尾：close 由 defer 完成，handler 据此向浏览器写 [DONE]
		}

		var frame remoteStreamFrame
		if err := json.Unmarshal(data, &frame); err != nil {
			slog.Warn("agent stream skipped malformed frame", "error", err)
			continue
		}
		if frame.Error != "" {
			// 上游流内失败：记日志后关流；错误绝不变成 delta，也不伪造 [DONE] 之外的语义。
			slog.Warn("agent stream upstream error frame", "error", frame.Error)
			return
		}
		if frame.Delta == "" {
			continue // 空 delta 无信息量，跳过
		}
		select {
		case out <- frame.Delta:
		case <-ctx.Done():
			return // 消费者/调用方离开：关 body（defer）+ 关通道（defer）
		}
	}
	if err := scanner.Err(); err != nil {
		// 含 bufio.ErrTooLong（单帧 >64KiB）与 ctx 取消打断的 body 读错误。
		slog.Warn("agent stream aborted", "error", err)
		return
	}
	// EOF 却从未见 [DONE]：上游被掐断（Python 错误帧后亦无 DONE）——记日志，通道照常 close。
	slog.Warn("agent stream truncated: reached EOF without [DONE]")
}

// previewBytes 给日志一个有界快照，避免畸形行本身把日志撑爆。
func previewBytes(b []byte) string {
	const max = 120
	if len(b) > max {
		return string(b[:max]) + "…"
	}
	return string(b)
}
