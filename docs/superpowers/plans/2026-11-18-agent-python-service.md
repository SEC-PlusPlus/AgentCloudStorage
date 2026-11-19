# Agent Python 微服务化（P1/P1.5/P2）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把单文件问答的 LLM 调用从 Go 进程内拆到独立 Python FastAPI 服务（P1 平迁），加双档降级（P1.5）与 SSE 流式（P2），公网契约与前端零改动。

**Architecture:** Go 保留鉴权、MinIO 访问、txt/md 抽取与分块（`internal/knowledge` 现状），在"拼好 source 之后"经窄 HTTP 契约调用 `agent/` Python 服务；Go 侧以 `Answerer` 接口统一 local（eino）/remote（HTTP）/composite（降级）三种实现。

**Tech Stack:** Go 1.26 + Gin + eino（既有）；Python 3.12 + FastAPI + openai SDK（httpx 可注入 mock transport）；Docker Compose（生产仅回环 agent）。

**Spec:** `docs/superpowers/specs/2026-11-18-agent-python-service-design.md`（本计划实现其 P1、P1.5、P2 三节；§4.5 P2.5 与 §4.4/§9 P3 各立后续计划，契约以 spec 为准冻结）

**Scope 说明：** P2.5/P3 不进本计划——P3 的 embedding 维度、VLM 行为是环境迭代事实，且公网契约扩展须先同步 React 重写计划（spec R6）再定稿其前端任务。本计划结束时 P1/P1.5/P2 为可运行、可演示、可上生产的完整状态。

## Global Constraints

- 模块名 `PersonalCloudStorage`；每任务收尾必须 `go build ./... && go vet ./... && go test ./...` 全绿再提交。
- 内部契约逐字冻结（spec §4.1）：`POST /v1/ask`，请求 `{"question": str, "source": str}`，响应 `{"answer": str}`；Python 上限 question ≤1000、source ≤20000（超限 422）；错误 401（token 不符）、502（上游 LLM 错误/空答案）、504（LLM 超时）。
- 超时链（spec R2）：Python `llm_timeout` 默认 **45.0s** < Go `agent.timeout` 默认 **60s**，两侧各写默认值测试钉死。
- 密钥：Go 侧 env `AGENT_API_KEY`，Python 侧 env `AGENT_INTERNAL_TOKEN`，同值双发；鉴权头 `Authorization: Bearer <token>`，Python 用 `hmac.compare_digest`。
- system prompt 双份维护（spec R1）：Go `local.go` 与 Python `prompts.py` 逐字相同（含防注入句），两文件头部注释互相指认。
- Python 侧禁止引入 LangChain/LangGraph；依赖白名单：fastapi、uvicorn、openai、pydantic-settings、pytest、httpx。
- 不改动 `web/` 任何文件；公网端点仍只有 `POST /api/v1/knowledge/ask`。
- 提交信息用英文 conventional commits（与仓库现状一致）。

## Review Focus

规格隐含但任务测试默认不覆盖、最容易咬人的输入/失效模式（每条在括号标注钉住它的任务）：

1. **超时倒挂**：有人把 Go `agent.timeout` 调到 < Python LLM 超时 → Go 先掐线，用户无答案但 LLM 已计费（Task 1、Task 5 的默认值断言 + 配置注释）。
2. **SSE 被代理缓冲**：Go 响应缺 `X-Accel-Buffering: no` → 经生产 nginx 打字机变"整段蹦出"，本地直连却正常（Task 11 头部断言测试）。
3. **取消不传播**：用户关页面 → Go/Python 继续烧 token，或 composite 误把"取消"当"故障"回落本地再调一次 LLM（Task 3、Task 9、Task 10）。
4. **token 配错被静默降级**：401 若当普通故障处理，composite 永远走本地、远端形同虚设（Task 4、Task 9）。
5. **响应体失控**：Python 故障/被入侵返回超大 JSON 或无限流 → Go OOM（Task 3 的 1MB 上限、Task 11 的流式 4MB 上限）。

---

## Task 1: Go 配置 — AgentConfig

**Files:**
- Modify: `internal/config/config.go`（`Config` 结构、`bindings` map、`validate()`、超时默认值）
- Test: `internal/config/config_test.go`（沿用文件内既有写法——先看现有用例如何造 yaml/env）

**Interfaces:**
- Produces: `config.AgentConfig{BaseURL string; APIKey string; Timeout time.Duration}`（mapstructure 节 `agent`；env 绑定 `AGENT_BASE_URL`/`AGENT_API_KEY`/`AGENT_TIMEOUT`）；`Config.Agent`。

- [ ] **Step 1: 写失败测试**（三个用例）：
  - `TestAgentTimeoutDefault`：yaml 不含 agent 节 → `cfg.Agent.Timeout == 60*time.Second`（并注释"必须 > agent 侧 llm_timeout 45s，见 Review Focus 1"）。
  - `TestAgentRequiresKeyWhenBaseURLSet`：`agent.base_url` 非空、无 api_key → `Load()` 报 `agent.api_key is required when agent.base_url is set`。
  - `TestAgentEnvOverrides`：env `AGENT_BASE_URL`/`AGENT_API_KEY` 注入生效。

- [ ] **Step 2: 跑测试确认失败** `go test ./internal/config/ -v`
- [ ] **Step 3: 实现**：`AgentConfig` 类型 + `Config.Agent` 字段 + bindings 三行 + validate 规则；`Unmarshal` 后 `if cfg.Agent.Timeout == 0 { cfg.Agent.Timeout = 60 * time.Second }`。
- [ ] **Step 4: 测试全绿**（含既有 config 用例回归）
- [ ] **Step 5: Commit** `feat(config): add agent service configuration with 60s default timeout`

## Task 2: Go — Answerer 接口与 LocalAnswerer（行为保持重构）

**Files:**
- Create: `internal/knowledge/answerer.go`（接口 + sentinel 错误）
- Create: `internal/knowledge/local.go`
- Modify: `internal/knowledge/ask.go`（拆 `PrepareAsk`，`AskFile` 换签名）
- Modify: `internal/httpapi/knowledge_handler.go`（字段类型 `model.BaseChatModel` → `knowledge.Answerer`）
- Modify: `cmd/server/main.go`（`knowledge.NewLocalAnswerer(chatModel)` 注入）
- Test: `internal/knowledge/local_test.go`

**Interfaces:**
- Produces:
```go
type Answerer interface {
    Answer(ctx context.Context, question, source string) (string, error)
}
var (
    ErrAgentUnauthorized = errors.New("agent unauthorized") // 本任务仅声明
    ErrAgentUnavailable  = errors.New("agent unavailable")  // Task 3 使用
    ErrUpstreamLLM       = errors.New("upstream llm error") // local/remote 共用
)
func PrepareAsk(ctx context.Context, files *file.Service, ownerID, fileID uint64, question string) (q, source string, err error)
func AskFile(ctx context.Context, files *file.Service, a Answerer, ownerID, fileID uint64, question string) (string, error)
func NewLocalAnswerer(chatModel model.BaseChatModel) *LocalAnswerer
```
- `PrepareAsk` = 现 `ask.go:21-46` 逐行搬迁（trim/500 rune 校验、PrepareFile、8000 rune 拼接），错误仍为普通 error（公网映射保持现状）。
- `LocalAnswerer.Answer` = 现 `ask.go:48-70` 搬迁（messages 构造、Generate、空答案检查）；**错误语义变更（有意）**：Generate 失败与空答案包装为 `ErrUpstreamLLM`，Task 4 将其映射 502（现为 500，前端只展示文案，可接受）。
- system prompt 常量 `local.go` 逐字复制 `ask.go:51-53`，头部注释 `// 与 agent/app/prompts.py 保持逐字一致（spec R1）`。

- [ ] **Step 1: 写失败测试** `local_test.go`（fake 实现 `model.BaseChatModel`，接口方法集以 eino 当前定义为准）：
  - `TestLocalAnswererBuildsExpectedMessages`：fake 捕获 messages，断言 system content == 逐字常量、user content == `"文件段落：\n"+source+"\n问题："+question`、返回值已 TrimSpace。
  - `TestLocalAnswererWrapsGenerateError`：fake 返回 error → `errors.Is(err, ErrUpstreamLLM)`。
  - `TestLocalAnswererRejectsEmptyAnswer`：fake 返回空白 Content → `ErrUpstreamLLM`。
- [ ] **Step 2: `go test ./internal/knowledge/ -v` 确认失败**
- [ ] **Step 3: 实现搬迁**（ask.go 里被搬走的代码删除，不留死代码）
- [ ] **Step 4: `go build ./... && go vet ./... && go test ./...` 全绿**（handler/main 编译修复在本任务内完成）
- [ ] **Step 5: Commit** `refactor(knowledge): introduce Answerer interface with local eino implementation`

## Task 3: Go — RemoteAnswerer

**Files:**
- Create: `internal/knowledge/remote.go`
- Test: `internal/knowledge/remote_test.go`

**Interfaces:**
- Consumes: Task 2 的 `Answerer`、三个 sentinel。
- Produces: `func NewRemoteAnswerer(baseURL, apiKey string, timeout time.Duration) *RemoteAnswerer`；`Answer` 调 `baseURL+"/v1/ask"`。
- 错误映射（Task 4/9/11 依赖，钉死）：`401→ErrAgentUnauthorized`；`502,504→ErrUpstreamLLM`；`≥500 其余、422/415 等其余 4xx、transport 错误（含超时）→ErrAgentUnavailable`；`200` 解码失败或 `answer` 空白→`ErrUpstreamLLM`；**ctx 已取消/超时→直接返回 ctx.Err()，不包装**（Review Focus 3）。
- 卫生：请求体 json 编码两字段；响应 `io.LimitReader(body, 1<<20)`（Review Focus 5）。

- [ ] **Step 1: 写失败测试**（`httptest.Server` 五路 + 两路卫生）：
  - `TestRemoteAnswerSuccess`：断言收到的 method/path/Authorization 头/请求体 JSON 字段名 `question`,`source`；返回 `{"answer":" 文本 "}` → 得 `"文本"`。
  - `TestRemoteAnswerErrorMapping`：表驱动 401/502/504/500/422 → 对应 sentinel。
  - `TestRemoteAnswerRespectsContextCancel`：server 端 `select{case <-r.Context().Done():}` 挂起，client ctx 取消 → 立即返回 `context.Canceled`。
  - `TestRemoteAnswerLimitsBody`：server 回 2MB JSON → 返回错误、进程无恙。
  - `TestRemoteAnswerTransportError`：server 提前 Close → `ErrAgentUnavailable`。
- [ ] **Step 2: `go test ./internal/knowledge/ -run Remote -v` 确认失败**
- [ ] **Step 3: 实现**（`http.Client{Timeout: timeout}` + `http.NewRequestWithContext`）
- [ ] **Step 4: 测试全绿**
- [ ] **Step 5: Commit** `feat(knowledge): add remote answerer over internal HTTP contract`

## Task 4: Go — handler 错误映射与 main 装配

**Files:**
- Modify: `internal/httpapi/knowledge_handler.go`
- Modify: `cmd/server/main.go:82-94`
- Test: `internal/httpapi/knowledge_handler_test.go`

**Interfaces:**
- Consumes: Task 2/3 类型与 sentinel。
- Produces: `func statusForAskError(err error) (int, string)`（同包纯函数，供 handler 与测试）。映射：`file.ErrFileNotFound→(404,"file not found")`；`ErrAgentUnauthorized→(500,"agent misconfigured")` 且 `slog.Error`（不降级，Review Focus 4）；`ErrAgentUnavailable→(503,"AI 服务暂不可用")`；`ErrUpstreamLLM→(502,"AI 服务繁忙，请稍后重试")`；default→(500,"ask file failed")。

- [ ] **Step 1: 写失败测试**：`statusForAskError` 表驱动（含包装 `fmt.Errorf("%w")` 一层）；handler 层：伪造带 remote 配置的服务器启动太重，纯函数覆盖即可 + 一个 gin 测试断言 400 路径（非法 JSON body 行为不变）。
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现** handler 改造（含 spec §8 审计：每次 ask 结束记一条 `slog.Info`，字段 `owner_id, file_id, elapsed_ms, ok`）+ main.go 装配：
```go
if cfg.Agent.BaseURL != "" {
    answerer = knowledge.NewRemoteAnswerer(cfg.Agent.BaseURL, cfg.Agent.APIKey, cfg.Agent.Timeout)
} else {
    // 原 AI 必填校验与 chatModel 构造整体移入此分支，注入 NewLocalAnswerer
}
```
- [ ] **Step 4: `go build ./... && go vet ./... && go test ./...` 全绿**
- [ ] **Step 5: Commit** `feat(httpapi): map agent errors and wire remote answerer`

## Task 5: Python — 服务骨架（settings/security/healthz）

**Files:**
- Create: `agent/app/__init__.py`、`agent/app/settings.py`、`agent/app/security.py`、`agent/app/main.py`
- Create: `agent/requirements.txt`、`agent/pytest.ini`（`pythonpath = .`，testpaths=tests）、`agent/tests/conftest.py`
- Test: `agent/tests/test_health_auth.py`

**Interfaces:**
- Produces:
  - `Settings(BaseSettings)`：`agent_internal_token: str`、`ai_base_url: str`、`ai_model: str`、`ai_api_key: str`、`llm_timeout: float = 45.0`（env 大写同名；默认值注释指向 Review Focus 1）。
  - `create_app(settings: Settings | None = None) -> FastAPI`：`app.state.settings/settings.llm_client` 槽位（Task 6 用）；`GET /healthz → {"status":"ok"}`（无鉴权）；依赖 `require_internal_token`：`Authorization: Bearer x` 且 `hmac.compare_digest`。
  - conftest：`client` fixture = `TestClient(create_app(Settings(...fake env...)))`。

- [ ] **Step 1: 写失败测试**：`test_healthz_open`；`test_protected_requires_exact_bearer`（缺头/错头/对头三断言，用 Task 6 才有的路由前先给一个挂了 `require_internal_token` 的探针路由 `/_auth_probe`）；`test_llm_timeout_default_is_45`（`Settings.model_fields["llm_timeout"].default == 45.0`）。
- [ ] **Step 2: 建 venv 装依赖，`python -m pytest -q` 确认失败**（Windows：`python -m venv .venv && .venv\Scripts\pip install -r requirements.txt`）
- [ ] **Step 3: 实现三文件**
- [ ] **Step 4: pytest 全绿**
- [ ] **Step 5: Commit** `feat(agent): python service skeleton with settings and bearer auth`

## Task 6: Python — `POST /v1/ask`

**Files:**
- Create: `agent/app/prompts.py`、`agent/app/schemas.py`、`agent/app/ask.py`
- Modify: `agent/app/main.py`（挂路由，删 `/_auth_probe`）
- Test: `agent/tests/test_ask.py`

**Interfaces:**
- Consumes: Task 5 的 app/依赖。
- Produces:
  - `schemas.AskRequest`：`question: str = Field(min_length=1, max_length=1000)`、`source: str = Field(min_length=1, max_length=20000)`。
  - `prompts.SYSTEM_PROMPT`（与 Go local.go 逐字一致）与 `build_messages(question, source) -> list[dict]`（user content 格式 `"文件段落：\n{source}\n问题：{question}"`）。
  - `async def answer_question(client: AsyncOpenAI, model: str, question: str, source: str) -> str`（空 content 抛 `UpstreamError`）；路由层异常翻译：`APITimeoutError→504`，`APIStatusError/APIConnectionError/UpstreamError→502`。

- [ ] **Step 1: 写失败测试**（`AsyncOpenAI(http_client=httpx.AsyncClient(transport=httpx.MockTransport(h)))` 注入，覆盖 `app.state.llm_client`）：
  - `test_ask_success_and_payload_shape`：mock 捕获上游请求体，断言 model 名、system content == `prompts.SYSTEM_PROMPT`、user content 格式；响应 `{"answer": " 文本 "}` 且已 strip。
  - `test_ask_422_on_limits`：question 1001 字 / source 20001 字。
  - `test_ask_401_without_token`。
  - `test_ask_502_on_empty_content`、`test_ask_504_on_apitimeouterror`（transport 抛 `httpx.ReadTimeout`）。
- [ ] **Step 2: pytest 确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: pytest 全绿**（含 Task 5 回归）
- [ ] **Step 5: Commit** `feat(agent): implement internal /v1/ask contract`

## Task 7: Python — Dockerfile 与本地运行文档

**Files:**
- Create: `agent/Dockerfile`、`agent/README.md`

- [ ] **Step 1: `pip freeze` 把 Task 5/6 依赖锁定为精确版本写入 requirements.txt**（保持白名单，剔除意外传递依赖不需处理——pip freeze 只列直接+传递，注明"锁定版"）
- [ ] **Step 2: main.py 加模块级实例** `app = create_app()`（缺失 env 时报错信息点名缺哪个变量；Task 5/6 测试继续用 `create_app(Settings(...))` 工厂注入，不受影响）。
- [ ] **Step 3: Dockerfile**：`python:3.12-slim`、non-root `useradd`、`COPY agent/ ./`（以仓库根为 build context：`docker build -f agent/Dockerfile .`）、`CMD ["uvicorn","app.main:app","--host","127.0.0.1","--port","8001"]`、`HEALTHCHECK` 用 `python -c "import urllib.request;..."` 访问 /healthz（slim 无 curl/wget）。
- [ ] **Step 4: `docker build -f agent/Dockerfile -t agentcloud-agent:smoke .` 成功**
- [ ] **Step 5: agent/README.md**：开发启动（venv + uvicorn 127.0.0.1:8001 + 必需 env 表）、测试命令、与 spec §7 生产回环部署一句。
- [ ] **Step 6: Commit** `feat(agent): containerized agent service and dev docs`

## Task 8: P1 端到端冒烟 + 验收记录

**Files:**
- Modify: `web/docs/feature-progress.md`（M7 真实 API 一栏状态更新）
- Modify: `config.example.yaml`（补 `agent:` 注释示例节）

- [ ] **Step 1:** 按 README 起依赖栈 + MySQL 迁移；起 agent（假 LLM 不可用——本冒烟用真实智谱密钥，`config.yaml` 现成）。
- [ ] **Step 2:** Go 端 `agent.base_url: http://127.0.0.1:8001` + `AGENT_API_KEY=test-internal` 启动 `go run ./cmd/server`。
- [ ] **Step 3:** PowerShell 冒烟：注册→登录→`POST /files` 上传一个含事实句的 .txt→`POST /api/v1/knowledge/ask`（正确 Bearer 的用户 JWT）→ 断言 200 且 answer 非空、含 `[n]`；**公网响应 JSON 形状与旧版逐字段一致**（`{"answer":...}`）。
- [ ] **Step 4:** 停掉 agent 进程→重复 ask→断言 `503 {"error":"AI 服务暂不可用"}`；清空 `agent.base_url`→ask 走本地路径仍 200（本地档回归）。
- [ ] **Step 5:** `cd web && npm run dev`，浏览器登录→文件行"提问"→面板出答案——确认前端零改动仍全绿（spec P1 验收原文）。
- [ ] **Step 6:** feature-progress.md 将 M7 标记为"P1 远端模式真实链路冒烟通过（2026-11-19）"；config.example.yaml 加注释节。
- [ ] **Step 7: Commit** `docs: record P1 end-to-end smoke of python agent service`

## Task 9: P1.5 — CompositeAnswerer 双档降级

**Files:**
- Create: `internal/knowledge/composite.go`
- Modify: `cmd/server/main.go`（remote+AI 完整→composite；remote+AI 缺→仅 remote 并 slog.Warn；都缺→仅 local，即原校验）
- Test: `internal/knowledge/composite_test.go`

**Interfaces:**
- Consumes: sentinel 语义、Task 3 的"ctx 取消返回裸 ctx.Err()"约定。
- Produces: `func NewCompositeAnswerer(primary, fallback Answerer) *CompositeAnswerer`（fallback 可为 nil=直通）。
- 回落条件（钉死）：`errors.Is(err, ErrAgentUnavailable) || errors.Is(err, ErrUpstreamLLM)` 且 `ctx.Err() == nil` 且 fallback != nil；**ErrAgentUnauthorized、ctx 取消绝不回落**（Review Focus 3/4）；回落时 `slog.Warn("agent fallback", ...)`；fallback 也失败→返回 fallback 的 error。

- [ ] **Step 1: 写失败测试**（表驱动 fake 两档）：primary 成功不调 fallback；primary `ErrAgentUnavailable`（wrapped）→fallback 结果；primary 401→原样错且不触 fallback；primary 错但 ctx 已取消→不 fallback；fallback 挂→返回其错误。
- [ ] **Step 2: 确认失败**
- [ ] **Step 3: 实现 + main 装配改造**
- [ ] **Step 4: 全绿；本地真机复验 Task 8 步骤 3 后 kill agent → ask 仍 200（走本地），Go 日志含 fallback Warn**
- [ ] **Step 5: Commit** `feat(knowledge): composite answerer with local fallback`

## Task 10: P2 Python — `POST /v1/ask/stream`

**Files:**
- Modify: `agent/app/ask.py`、`agent/app/main.py`
- Test: `agent/tests/test_ask_stream.py`

**Interfaces:**
- Produces: SSE 帧格式（Go Task 11 依赖，逐字冻结）：每增量 `data: {"delta": "<json字符串>"}\n\n`；正常收尾 `data: [DONE]\n\n`；中途上游失败在已开流后发 `data: {"error": "upstream llm failure"}\n\n` 即关流（无 DONE）。响应头 `text/event-stream; charset=utf-8`、`Cache-Control: no-cache`、`X-Accel-Buffering: no`。
- 上游：`client.chat.completions.create(..., stream=True)`，复用 `prompts.build_messages`；**finally 中 `await stream.close()`**（Review Focus 3）；开流前的错误（401/422/连不上）仍走普通 JSON 状态码。

- [ ] **Step 1: 写失败测试**：mock transport 返回 openai 风格 SSE 体（三个 content chunk）→ 断言客户端逐帧序列（含 `[DONE]`）与头三件套；`test_stream_disconnect_closes_upstream`：transport 生成器带 `closed: bool` 标志 + 无限慢速 chunk，`client.stream` 读一帧后 `aclose()`，等一个 tick 断言 `closed is True`；`test_stream_422_and_401_plain_json`。
- [ ] **Step 2: pytest 确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: pytest 全绿**
- [ ] **Step 5: Commit** `feat(agent): streaming /v1/ask/stream with cancellation-safe upstream`

## Task 11: P2 Go — StreamAnswer 透传（接口扩展 + handler）

**Files:**
- Modify: `internal/knowledge/answerer.go`、`local.go`、`remote.go`、`composite.go`
- Modify: `internal/httpapi/knowledge_handler.go`
- Test: `internal/knowledge/remote_test.go`（追加）、`internal/httpapi/knowledge_handler_test.go`（追加）、`composite_test.go`（追加）

**Interfaces:**
- Produces:
```go
type Answerer interface {
    Answer(ctx context.Context, question, source string) (string, error)
    StreamAnswer(ctx context.Context, question, source string) (<-chan string, error)
}
```
  `StreamAnswer` 同步返回的 error 用 Task 3 同一张状态映射表（开流前失败=可 503/502/500）；channel 缓冲 64，正常/异常/取消都**只以 close 结束**（错误经 slog 记录，不再上抛）。Remote 解析：`bufio.Scanner`（buffer 调大到 64KB/行）读 `data: ` 行，`{"delta"}` 发通道，`[DONE]` 关，`{"error"}` 记 Warn 关；**累计字节 ≤4MB，超限记 Warn 关流**（Review Focus 5）；ctx 取消→关闭 resp body、关通道。Local：`chatModel.Stream` → 逐条 `msg.Content` 入通道（eino StreamReader 方法名以 vendor 实际为准）。Composite：primary 同步报错且符合 Task 9 回落条件→goroutine 调 `fallback.Answer` 整段作单个 delta 后 close。
- Handler：`askFileRequest` 增 `Stream bool`（json `stream`）。`stream==true` 且 PrepareAsk 成功后：设 `Content-Type: text/event-stream`、`Cache-Control: no-cache`、`X-Accel-Buffering: no`（Review Focus 2）、`http.Flusher` 逐帧写 `data: {"delta":...}` + Flush（JSON 编码用 `encoding/json` 保证转义），结束写 `data: [DONE]`；开流前错误走 `statusForAskError`；`stream==false` 路径行为逐字不变。

- [ ] **Step 1: 写失败测试**：
  - remote：httptest 回放三帧+[DONE]→收到三 delta；401→`ErrAgentUnauthorized` 无通道泄漏；慢流中途 ctx cancel→通道关闭；2MB 单帧超限→关流且不 panic。
  - composite：primary 开流即错（Unavailable）→ 收到 fallback 单 delta；401→原样 error。
  - handler 纯函数/头断言：`streamResponseHeaders()`（或等价小函数）返回的三头值精确断言；非法 JSON 仍 400。
- [ ] **Step 2: 确认失败**（接口扩展会让 fake Answerer 编译失败——测试文件里同步补方法）
- [ ] **Step 3: 实现四个 Answerer + handler**
- [ ] **Step 4: `go test ./... && go vet ./...` 全绿**
- [ ] **Step 5: Commit** `feat(knowledge): end-to-end SSE streaming through Answerer chain`

## Task 12: P2 端到端验收 + 生产部署接线

**Files:**
- Modify: `deploy/compose.yaml`（生产形态：agent 服务，spec §7——`ports: ["127.0.0.1:8001:8001"]`、`expose` 不写、env 五项、healthcheck、restart）
- Modify: `deploy/nginx.secplusplus.conf`（`location /api/` 加 `proxy_buffering off; proxy_read_timeout 120s;`，注释注明 P2 依赖；本任务只改文件，上线属未来部署）
- Modify: `README.md`（已实现列表加"问答由独立 Python agent 服务承载，本地可降级内嵌 eino"一句 + agent 启动指引链接）
- Modify: `web/docs/feature-progress.md`（P2 冒烟记录）

- [ ] **Step 1:** 本地起 agent + Go（composite 配置：agent + 完整 AI env），`curl -N` 打 `{"file_id":...,"question":...,"stream":true}` → 断言逐帧 `data: {"delta"` 增量出现（非一次性返回）。
- [ ] **Step 2:** `curl` 中途 Ctrl+C → agent 日志确认上游流 close（Task 10 的 closed 标志路径）；kill agent → stream:true 请求 → composite 回落在开流前以整段单 delta 完成（断言收到含全文的一个 delta + DONE）；`stream` 缺省回归 P1 非流式。
- [ ] **Step 3:** `go test ./... && go vet ./...`、`pytest` 双绿。
- [ ] **Step 4:** 更新四份文件（生产仅部署 P1/P1.5：nginx 缓冲改动与 SSE 一起提交但不强制上线，README 注明"P2 公网开放随 React 前端，生产先行部署 agent 的 /v1/ask 非流式"）。
- [ ] **Step 5: Commit** `feat(deploy): loopback agent service and nginx SSE preparation`

---

## 后续计划（不在本计划内，依赖本计划完成）

- **Plan B（P2.5 文档理解）**：spec §4.5 字节通道 + `parse.py`（pymupdf/VLM），需先在 React spec 侧登记 canAsk 白名单扩展。
- **Plan C（P3 本地 RAG）**：spec §4.4 + Qdrant 容器 + `ask/kb` + reindex 单飞；embedding 维度、检索质量按 R3 迭代调参。
