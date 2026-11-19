package knowledge

import (
	"context"
	"errors"
	"log/slog"
)

// CompositeAnswerer 双档降级：primary（远端 agent 服务）瞬时失败时回落到 fallback（本地 eino 档）。
// 实现与两个档位相同的单方法 Answerer 接口（Task 11 再统一扩展 StreamAnswer）。
type CompositeAnswerer struct {
	primary  Answerer
	fallback Answerer // 可为 nil：退化为直通，不产生包装噪声。
}

// NewCompositeAnswerer 构造双档 Answerer；fallback 允许为 nil（等价于只用 primary）。
func NewCompositeAnswerer(primary, fallback Answerer) *CompositeAnswerer {
	return &CompositeAnswerer{primary: primary, fallback: fallback}
}

// Answer 先调 primary；仅当错误命中瞬时哨兵（ErrAgentUnavailable / ErrUpstreamLLM）
// 且调用方 ctx 仍存活时才回落：
//   - ErrAgentUnauthorized 是配置错误，必须响亮上抛，绝不掩盖（Review Focus 4）；
//   - ctx 取消/超时期间用户已离开，回落只会浪费算力，且 RemoteAnswerer 此时返回的是
//     裸 ctx.Err()（Task 3 契约），不含哨兵，天然不触发回落（Review Focus 3）。
//
// 回落时记 slog.Warn("agent fallback")（含 primary 原始错误）；fallback 也失败则原样
// 返回 fallback 的错误——它才是调用方最终面对的那一层。
func (a *CompositeAnswerer) Answer(ctx context.Context, question, source string) (string, error) {
	answer, err := a.primary.Answer(ctx, question, source)
	if err == nil {
		return answer, nil
	}
	if a.fallback == nil || ctx.Err() != nil {
		return "", err
	}
	if !errors.Is(err, ErrAgentUnavailable) && !errors.Is(err, ErrUpstreamLLM) {
		return "", err
	}

	slog.Warn("agent fallback", "error", err)
	return a.fallback.Answer(ctx, question, source)
}

// StreamAnswer 与 Answer 共用回落门（Task 9）：仅当 primary【开流前】同步报错、
// 错误命中瞬时哨兵、ctx 仍存活且 fallback 存在时，才回落——回落形态为
// goroutine 调 fallback.Answer 把整段答案作为【单个 delta】入道后 close。
// 不可回落（unauthorized/ctx 死/无 fallback）：原样返回 primary 错误 + nil 通道。
// 开流成功后的流内失败已在 primary 通道语义内被 slog 消化，本层不重复介入。
func (a *CompositeAnswerer) StreamAnswer(ctx context.Context, question, source string) (<-chan string, error) {
	deltas, err := a.primary.StreamAnswer(ctx, question, source)
	if err == nil {
		return deltas, nil
	}
	if a.fallback == nil || ctx.Err() != nil {
		return nil, err
	}
	if !errors.Is(err, ErrAgentUnavailable) && !errors.Is(err, ErrUpstreamLLM) {
		return nil, err
	}

	slog.Warn("agent fallback", "error", err)
	out := make(chan string, streamChanBuffer)
	go func() {
		defer close(out)
		answer, fallbackErr := a.fallback.Answer(ctx, question, source)
		if fallbackErr != nil {
			// 通道不携带错误：回落也败只能记日志，浏览器收到空答案（Task 11 契约）。
			slog.Warn("agent stream fallback failed", "error", fallbackErr)
			return
		}
		select {
		case out <- answer:
		case <-ctx.Done():
		}
	}()
	return out, nil
}
