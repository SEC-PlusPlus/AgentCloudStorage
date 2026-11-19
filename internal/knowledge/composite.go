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
