package knowledge

import (
	"context"
	"errors"
)

// Answerer 抽象"根据文件段落回答问题"的上游实现：
// LocalAnswerer 直接调用 eino chatModel（本任务），remoteAnswerer 调用 Python agent 服务（Task 3）。
type Answerer interface {
	Answer(ctx context.Context, question, source string) (string, error)
}

var (
	ErrAgentUnauthorized = errors.New("agent unauthorized") // 本任务仅声明
	ErrAgentUnavailable  = errors.New("agent unavailable")  // Task 3 使用
	ErrUpstreamLLM       = errors.New("upstream llm error") // local/remote 共用
)
