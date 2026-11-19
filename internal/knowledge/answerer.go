package knowledge

import (
	"context"
	"errors"
)

// Answerer 抽象"根据文件段落回答问题"的上游实现：
// LocalAnswerer 直接调用 eino chatModel（本任务），remoteAnswerer 调用 Python agent 服务（Task 3）。
type Answerer interface {
	Answer(ctx context.Context, question, source string) (string, error)

	// StreamAnswer 以通道回放增量（Task 11）。语义：
	//   - 同步 error 仅覆盖"开流前"失败，且与 Answer 用同一张状态映射哨兵
	//     （401→ErrAgentUnauthorized 等），供 handler 出普通 JSON；
	//   - 通道缓冲 streamChanBuffer；正常收尾、上游错误帧、字节超限、
	//     ctx 取消一律以 close 结束——流内错误只经 slog 记录，不再上抛；
	//   - 返回非 nil error 时通道必为 nil。
	StreamAnswer(ctx context.Context, question, source string) (<-chan string, error)
}

// streamChanBuffer 是 StreamAnswer 通道的缓冲深度：略大于"上游一帧一 delta"的
// 即时消费节奏，防止生产者因消费者调度抖动而阻塞。
const streamChanBuffer = 64

var (
	ErrAgentUnauthorized = errors.New("agent unauthorized") // 本任务仅声明
	ErrAgentUnavailable  = errors.New("agent unavailable")  // Task 3 使用
	ErrUpstreamLLM       = errors.New("upstream llm error") // local/remote 共用
)
