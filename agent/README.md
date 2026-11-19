# agent — 内部问答服务 (FastAPI)

Go 后端调用的内部 HTTP 服务，提供 `GET /healthz` 与 `POST /v1/ask`（Bearer 鉴权，
契约见 `docs/superpowers/specs/2026-11-18-agent-python-service-design.md` §4–§5）。
仅监听回环/内网，绝不上公网。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `AGENT_INTERNAL_TOKEN` | 是 | Bearer 令牌，必须与 Go 侧 `AGENT_API_KEY` 同值（spec §4.1） |
| `AI_BASE_URL` | 是 | OpenAI 兼容端点（与 Go 侧 `ai.base_url` 同构，DeepSeek/Qwen/vLLM 均可） |
| `AI_MODEL` | 是 | 模型名 |
| `AI_API_KEY` | 是 | 上游 LLM 密钥 |
| `LLM_TIMEOUT` | 否 | 单次上游调用超时秒数，默认 `45`（必须保持 < Go 侧 60s 客户端超时，见 app/main.py 注释） |

## 本地开发运行

依赖已锁定在 `requirements.txt`（Task 7 冻结的精确版本，勿手改；升级后重新
`pip freeze`）。venv 位于 `agent/.venv`，如缺失：

```powershell
cd agent
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

启动（回环，8001）：

```powershell
cd agent
$env:AGENT_INTERNAL_TOKEN="devtoken"; $env:AI_BASE_URL="http://127.0.0.1:9"; $env:AI_MODEL="m"; $env:AI_API_KEY="k"
.venv\Scripts\python.exe -m uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8001
curl.exe http://127.0.0.1:8001/healthz   # -> {"status":"ok"}
```

（bash/zsh 下等价：`AGENT_INTERNAL_TOKEN=... .venv/Scripts/python.exe -m uvicorn --factory app.main:create_app --host 127.0.0.1 --port 8001`）

### 为什么用 `--factory`（重要约定）

`app/main.py` **故意不定义模块级 `app = create_app()`**：`create_app()` 无参会构造
`Settings()`，它在 import 时就要求上述必需环境变量，会让任何 env-free 的
`import app.main`（尤其整套 pytest，测试自行注入 `Settings(...)`）直接崩溃。
因此开发、Docker、生产统一走 uvicorn 工厂模式
`uvicorn --factory app.main:create_app`——`create_app()` 在环境变量就位之后才被调用。
验收：在清空上述变量的环境里 `python -c "import app.main"` 必须成功。

## 测试

```powershell
cd agent
.venv\Scripts\python.exe -m pytest
```

## Docker

构建上下文是**仓库根**：

```powershell
docker build -f agent/Dockerfile -t agentcloud-agent .
docker run --rm -p 127.0.0.1:8001:8001 -e AGENT_INTERNAL_TOKEN=... -e AI_BASE_URL=... -e AI_MODEL=... -e AI_API_KEY=... agentcloud-agent
```

镜像内 CMD 绑定 `0.0.0.0:8001` 是正确且刻意的：容器有独立网络命名空间，绑定地址
由宿主发布端口决定（见下），镜像保持 bind-agnostic。

## 生产部署

按 spec §7 的修正布局：agent 加入**依赖 compose**，宿主 Go（systemd）访问回环；
compose 里 `ports: ["127.0.0.1:8001:8001"]` 只绑回环、Go 侧
`AGENT_BASE_URL=http://127.0.0.1:8001`，nginx 不加任何 location，agent 永不公网
暴露。详见 `docs/superpowers/specs/2026-11-18-agent-python-service-design.md` §7。
