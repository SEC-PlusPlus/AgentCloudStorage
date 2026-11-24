# 部署与数据库迁移规程（deploy runbook）

适用：本地开发库（宿主机端口 3307，容器 `govault-mysql`——注意它是手工 `docker run` 起的开发容器，**不是** `deploy/compose.yaml` 起的）与生产库（`deploy/compose.yaml`，项目名 `agentcloudstorage`，容器随之命名为 `agentcloudstorage-mysql-1`）。本文件是全仓库第一次把 migration 应用流程成文；A6 真机冒烟（2026-11-25，`000006_create_share_links.up.sql` 首次应用 + 分享链接端到端验证）即按此规程执行。

**容器名先实测，别照抄**：各环境容器名不同，执行任何 `docker exec` 前先跑

```bash
docker ps --format '{{.Names}}' | grep -i mysql
```

把下面命令里的 `<mysql-container>` 替换为实测名（dev=`govault-mysql`，prod=`agentcloudstorage-mysql-1`）。命令形态（凭据走 `MYSQL_PWD` 环境变量、绝不内联）不因环境而变。

## 前提

- 应用**不会自动迁移**：服务启动只连库建池，不执行 `migrations/` 里的 SQL。新 migration 必须手动应用后再发布新代码。
- 凭据一律来自 gitignore 的本地 `.env` / 环境变量，**禁止**写进命令历史复用、文档或提交物。
- 注意：`.env` 的值含 `(`、`&` 等字符，PowerShell `Get-Content` 逐行解析或 `source .env`（bash）都可能失败或注入——注入进程时用按行 `export "K=V"` 的方式，取值走程序化解析。

## 每次新 migration 的手动应用规程

以 `000006_create_share_links.up.sql` 为例（其余编号同理，逐个应用）：

以下命令中 `<mysql-container>` 均为开头实测得到的容器名；`MYSQL_PWD` 由本地 `.env` 的 DSN/字段注入进程环境，docker 侧只用 `-e MYSQL_PWD`（裸名继承本地环境变量），**不把密码展开进命令行**，避免 ps/进程监视器与 shell history 泄露。

1. **先看现状**（确认目标对象不存在 / 旧结构）：

   ```bash
   export MYSQL_PWD="${MYSQL_PASSWORD}"   # 值来自本地 .env，勿手打
   docker exec -i -e MYSQL_PWD <mysql-container> \
     mysql -ugovault govault -e "SHOW TABLES;"
   ```

2. **应用**（标准输入重定向）：

   ```bash
   docker exec -i -e MYSQL_PWD <mysql-container> \
     mysql -ugovault govault < migrations/000006_create_share_links.up.sql
   ```

   PowerShell 等价形态（同样走 `MYSQL_PWD` 继承，不用 `-p` 内联）：

   ```powershell
   $env:MYSQL_PWD = $env:MYSQL_PASSWORD   # 值来自本地 .env，勿手打
   Get-Content migrations\000006_create_share_links.up.sql -Raw |
     docker exec -i -e MYSQL_PWD <mysql-container> mysql -ugovault govault
   ```

3. **验证**（表存在 + 列结构与 spec 数据模型逐列对照）：

   ```bash
   docker exec -i -e MYSQL_PWD <mysql-container> \
     mysql -ugovault govault -e "SHOW TABLES LIKE 'share_links'; DESCRIBE share_links;"
   ```

   期望（000006）：`token char(43) UNI`、`owner_id/file_id MUL`、`display_name varchar(255) NOT NULL`、`password_hash varchar(60) NULL`、`expires_at/revoked_at NULL`、`download_count int 0`、`created_at/updated_at` 带默认值——与 `docs/superpowers/specs/2026-11-23-share-links-design.md` §2.1 一致。

4. **再发布代码**并冒烟（分享链接最小集：建 share → 访客 meta → verify → download）。

## 硬性规则

- **应用顺序：先 migration，后代码。** 新表/新列均为增量（可空或带默认），旧代码对新结构无感知即可向前兼容运行；反向（新代码先上）会撞缺表 500。
- **只前进，不回滚（forward-only）**：本仓库不使用 down migration，也不在现网执行 DROP。改错结构时，追加一条新的 up migration 修正，绝不平地回滚。
- migration 文件命名沿用 golang-migrate 数字前缀格式，但当前加载方式只有 MySQL 容器 initdb（全新库首启）与上述手动 `docker exec`（已有库升级）两条路径。
- 占位：秒传（instant upload，B 轨）将新增 `000007` / `000008` migration，届时直接复用本规程（命令与验证步骤一字不差，仅换文件名与 DESCRIBE 期望）。本文件此刻不含其内容。

## 本地依赖速查

- MySQL 宿主 `127.0.0.1:3307`、MinIO `127.0.0.1:9000/9001`、Redis `127.0.0.1:6380`（见 `deploy/compose.yaml` 与根 README）。
- 分享链接功能另需 Redis 在线做限流：`meta/download` 限流读失败时放行（fail-open + WARN 日志），`verify`（密码爆破面）Redis 不可用时返回 503（fail-closed）——这是设计行为，重启 Redis 即恢复，无需清键。
