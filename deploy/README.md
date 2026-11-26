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
- 秒传/去重（B 轨）的 `000007` / `000008` 已落地，应用与验证见下文《秒传/去重（B 轨）》一节；该节同时钉死"只前进不回滚"与 versioning-off 两条硬约束。

## 秒传/去重（B 轨）：000007 / 000008 的应用

沿用上面的《每次新 migration 的手动应用规程》，逐个应用，仅换文件名与 DESCRIBE 期望：

- `000007_create_objects.up.sql`：期望 `SHOW TABLES LIKE 'objects'` + `DESCRIBE objects;` —— `sha256 char(64) PRI`、`object_key varchar(255) UNI`、`size bigint NOT NULL`、`content_type varchar(127) NOT NULL`、`refcount int NOT NULL`、`created_at` 带默认值（spec §2.1）。
- `000008_add_sha256_to_files.up.sql`：`ALTER TABLE files ADD COLUMN sha256 CHAR(64) NULL` + 索引 `idx_sha256`，并 **`DROP INDEX uk_files_object_key`**。`SHOW INDEX FROM files` 里 `uk_files_object_key` 必须消失，`sha256` 列必须存在（spec §2.2）。

注意应用顺序仍然**先 migration 后代码**：新列可空、新表增量，旧代码无感；反之新代码会在缺表上 500。现网 files 表行数很小，MySQL 8 的 ADD COLUMN INSTANT/DROP INDEX INPLACE 秒级完成，无需低峰窗口。

## 只前进，不回滚（B 轨合入后的硬约束，spec §7）

- `uk_files_object_key` 已不存在且去重后 `files.object_key` **多行共享**：回滚唯一索引在有共享行时必然失败；更危险的是旧代码的 `PermanentDelete` 见行就 `storage.Delete(object_key)`，会误杀共享 blob。**结论：本功能合入后代码只前进不回滚。**
- 确需回滚的唯一安全前置：先恢复全量备份（files/objects 表 + bucket），或临时禁用删除端点并先把去重行全部物理化（重抄对象）——两者都比前滚贵，写 here 是为了让人别顺手 `git revert`。
- 改错结构时按既有规则追加新的 up migration 修正，绝不平地回滚。

## MinIO versioning-off 假设（去重语义依赖）

dev（`govault-minio`）与 prod（`deploy/compose.yaml`）的 bucket 都**不开 versioning**。理由：blob 覆盖（`CopyObject tmp→blobs/<sha>`）语义 = "最新版本即权威"，`List` 也只回当前版本；若开了 versioning，被"覆盖"的旧版本会滞留且 GC 的"无行即删"会漏算历史版本，延迟删除的安全论证失效。bucket 若被外部工具开了 versioning，blob-gc 的输出不再可信，先关掉再用。

## blob-gc 定时任务（延迟物理删除的执行者，spec §1.4）

`PermanentDelete` 对去重行**只减引用、只删行，从不删物理对象**（防止迟到的 Delete 杀掉刚重建的同 sha 对象——§1.4 数据丢失竞态的定案）；物理回收由 `cmd/blob-gc` 完成，规则="`blobs/` 前缀且 DB 无 objects 行且 age > 安全窗（默认 1h）"+"`users/*/tmp-*` 崩溃残留同窗清理"；`users/<uid>/<uuid>` 分片对象永不触碰。建议 cron（与备份任务错开）：

```cron
# 每天 04:30，容器宿主上跑（工作目录需能读到 config.yaml；凭据走环境）
30 4 * * * cd /opt/agentcloudstorage && /usr/local/bin/blob-gc >> /var/log/blob-gc.log 2>&1
```

先 `--dry-run` 看 JSON 计划再正式跑；`--max-age 0` 仅用于测试（删除所有"无行且已过期哪怕 1ns"的对象）。安全窗必须大于最长健康上传时长（直传 ≤50MiB，秒级完成），这也是"行先行、物随后"整个延迟删除设计存在的理由——B5 的 e2e 与集成测试证明了它防住的正是旧同步删除会踩的坑。

## 本地依赖速查

- MySQL 宿主 `127.0.0.1:3307`、MinIO `127.0.0.1:9000/9001`、Redis `127.0.0.1:6380`（见 `deploy/compose.yaml` 与根 README）。
- 分享链接功能另需 Redis 在线做限流：`meta/download` 限流读失败时放行（fail-open + WARN 日志），`verify`（密码爆破面）Redis 不可用时返回 503（fail-closed）——这是设计行为，重启 Redis 即恢复，无需清键。

## 生产上线前提（公网分享）

- **生产 Redis 必须 ≥7.0**：verify 限流的 Lua（`internal/share/limiter.go` 的 `accessCountScript`）用了 `PEXPIRE ... NX`——该写法 7.0 才支持。低版本下每次 verify 都报错，而 verify 是 fail-closed，表现为分享密码功能整体 503、静默失效（读侧 fail-open，故障更不易察觉）。`deploy/compose.yaml` 已钉 `redis:7-alpine`；若改用外部/复用 Redis，部署前实测版本，别照抄：`docker exec <redis-container> sh -c 'REDISCLI_AUTH="$REDIS_PASSWORD" redis-cli INFO server' | grep redis_version`（凭据走容器内环境变量，同上文 MYSQL_PWD 约定，不进命令行）。
- **nginx access_log 会原样记录分享凭据**：公开 URL 里的 `:token` 路径段与 `?access=` JWT 由反代明文落盘——应用层 gin 日志已由 `internal/httpapi/router.go` 的 `accessLogFormatter` 脱敏（token/JWT 各留前 8 字符），但 `deploy/nginx.secplusplus.conf` 这类反代层没有。启用公网分享前评估：给 `location ~ /api/v1/public/shares/` 关闭或单独脱敏 `access_log`，并接受相应的日志留存策略。
