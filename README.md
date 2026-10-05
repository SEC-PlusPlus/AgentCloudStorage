# AgentCloudStorage

基于 Go 的个人智能化网盘项目。当前完成基础网盘 API，Agent 知识库功能规划中。

## 技术栈

Go、Gin、GORM、MySQL、MinIO、Redis、JWT、Viper。

## 已实现

- 用户注册、登录与多用户数据隔离
- 文件上传、下载、搜索、移动和重命名
- 文件夹管理、回收站与永久删除
- 存储用量统计和容量配额
- Redis 登录尝试限流：同一邮箱与来源地址 10 分钟内最多尝试 5 次，成功登录后清零

## 本地 Redis

后端现在需要 Redis。首次运行可创建一个只绑定到本机的开发容器：

```powershell
docker run -d --name govault-redis -p 127.0.0.1:6380:6379 redis:7-alpine
```

以后重启已创建的容器用 `docker start govault-redis`。应用默认从 `config.yaml` 读取 `redis.addr: 127.0.0.1:6380`；这里的 6380 是宿主机端口，容器内仍为 6379。需要改地址时使用 `REDIS_ADDR`，Redis 设有密码时使用 `REDIS_PASSWORD`。这个本地示例没有设置 Redis 密码，因此只映射到本机回环地址，不应直接照搬到公网服务器。登录限流计数允许丢失，Redis 重建后重新计数；MySQL 用户和文件数据不在 Redis 中。

`config.yaml` 存非敏感设置，密码和密钥通过环境变量提供；Viper 不会自动读取 `.env` 文件。旧的 `MYSQL_DSN` 仍可覆盖结构化 MySQL 配置。

## 本地启动

首次运行先复制配置模板：

```powershell
Copy-Item config.example.yaml config.yaml
```

模板中的端口是宿主机上的开发示例：MySQL `3307`、MinIO `9000`、Redis `6380`。按自己的环境修改本地 `config.yaml`，并提供 `MYSQL_PASSWORD`（或已有的 `MYSQL_DSN`）、`MINIO_ACCESS_KEY`、`MINIO_SECRET_KEY` 和长度至少 32 字节的 `JWT_SECRET`。可参考 `.env.example`；Go 程序不会自动读取 `.env`，启动前需将其中的值注入进程环境。

依赖服务与数据库迁移准备好后，分别启动后端和前端：

```powershell
go run ./cmd/server

cd web
npm ci
npm run dev
```

前端地址是 `http://127.0.0.1:5173`，开发服务器会把 `/api` 请求转发到本机 `8080` 端口。不要将本地 `config.yaml`、`.env` 或 Docker 数据目录提交到仓库。

## 当前状态

基础业务已完成；自动化测试、部署配置和异常恢复仍在完善。
