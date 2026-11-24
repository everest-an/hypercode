# HyperCode 多租户云部署（X2：单机 + 每租户 rootless Docker）

> 面向**多客户**，单台专用主机起步。每个租户一套栈（compose project `hc-<tenant>`），
> 且每租户有**独立的 rootless Docker 引擎**——租户内的 `computer` 容器跑在自己的引擎里，
> **绝不把宿主 `docker.sock` 交给租户**（否则等于交出宿主 root）。

```
         手机(iOS) / 电脑(Web)  ← 同一套 Expo UI，同一个 workspace
                     │ HTTPS
        ┌────────────┴─────────────┐
        │  宿主机 Caddy（按子域路由） │
        └────────────┬─────────────┘
   ┌─────────────────┼─────────────────┐
   ▼                 ▼                 ▼
hc-<tenantA>     hc-<tenantB>      hc-<tenantC>      每租户独立 compose
 ├ postgres        ├ postgres        ├ postgres
 ├ worker(8790)    ├ worker          ├ worker
 └ server(8787)    └ server          └ server
     │ DOCKER_HOST=本租户 rootless socket
     ▼
 /run/user/<uid>/docker.sock  →  rootless dockerd  →  computer 容器(/workspace)
```

## 目录

```
workbench/deploy/tenant/
├─ Dockerfile.server          # server 镜像（内置 docker CLI，非 root）
├─ docker-compose.tenant.yml  # 每租户一套栈
├─ tenant.sh                  # provision / status / destroy
└─ README.md
```

## 1. 前置（宿主机，一次性）

```bash
# Docker + compose v2 已有；补 rootless 依赖
sudo apt-get update
sudo apt-get install -y uidmap dbus-user-session slirp4netns fuse-overlayfs docker-ce-rootless-extras openssl

# 确认非 root 用户能跑 rootless docker（系统已开 user namespaces）
sysctl kernel.unprivileged_userns_clone 2>/dev/null || true
```

> 本机（Mac 开发）可用 Colima 模拟，但生产是 Linux。

## 2. 开通一个租户

```bash
cd workbench/deploy/tenant
sudo HC_BASE_DOMAIN=cloud.awareliquid.ai \
     HC_MODEL=openai/deepseek-chat \
     HC_MODEL_BASE_URL=https://api.deepseek.com/v1 \
     HC_MODEL_KEY=sk-xxx \
     ./tenant.sh provision acme 18001
```

它会：
1. 建系统用户 `hc-acme` + `loginctl enable-linger`
2. 初始化该用户的 **rootless dockerd**，socket 在 `/run/user/<uid>/docker.sock`
3. 建 `data` 目录并 chown 给租户 uid
4. 生成 `tenants/acme.env`（随机口令/密钥）
5. 构建镜像：宿主 daemon 构建 `server`/`worker`；**租户 daemon 构建 `computer`**
6. `docker compose -p hc-acme up -d`
7. 打印 Caddy 配置片段 + 该客户的访问密钥

然后按提示在宿主机 Caddy 加一条：

```
acme.cloud.awareliquid.ai {
    reverse_proxy 127.0.0.1:18001
}
```

## 3. 隔离模型

| 层面 | 措施 |
|---|---|
| 租户间 | 独立 compose project / 独立网络 `hc-<t>-net` / 独立 postgres / 独立卷 |
| **Docker 面** | 每租户**独立 rootless dockerd**；server 只通过本租户 socket 管理 `computer` |
| 进程 | `computer` 非 root(1000)、`--read-only` 可用的只读 rootfs、cap-drop、配额（由 `computer.ts` 创建时控制） |
| 端口 | server 只绑 `127.0.0.1:<port>`，对外只经宿主机 Caddy |
| 数据 | 只挂 `tenants/<t>/data` 与租户 socket；不挂宿主业务目录 |
| 资源 | compose `mem_limit`；宿主给 awareness-box 预留 CPU/内存 |

## 4. 运维

```bash
sudo ./tenant.sh status acme      # docker compose ps
sudo ./tenant.sh destroy acme     # 停栈+删卷，保留 tenants/acme 数据与用户
```

- **备份**：`tenants/acme/data` + `docker compose -p hc-acme exec postgres pg_dumpall`
- **升级**：改镜像后 `docker compose -p hc-acme up -d`（逐租户滚动）

## 5. 必须知道的坑

| # | 坑 | 说明 |
|---|---|---|
| 1 | **`CPK_INTELLIGENCE_API_KEY` 是硬依赖** | 默认 `HYPERCODE_THREADS=cloud` 需要 CopilotKit Intelligence（第三方云）。要摆脱它只能 `HYPERCODE_THREADS=local`（线程历史进程内、重启丢）。国内上线/数据出境需先决策 |
| 2 | **computer 由 server 按需创建** | 镜像必须构建在**租户自己的 daemon** 里（脚本已做），否则 server 找不到镜像 |
| 3 | **rootless 的 egress 不受宿主 iptables 管** | rootless docker 用 slirp4netns，`harden-egress.sh`(宿主 DOCKER-USER) 不覆盖它。P0 可接受；P1 需在 rootless 侧加白名单/代理 |
| 4 | 端口规划 | 每租户分配唯一 `HOST_PORT`（如 18001、18002…），避免冲突 |

## 6. 上线前 Gap（P1）

1. `apps/server` 加 `tenant_id` 多租户 → 可共享 server 省资源（当前每租户一套，稳但重）
2. rootless → microVM（Firecracker/Kata）或每客户独立节点
3. 接 trust3 计费（容器秒 + token）+ 空闲停机
4. 审计/日志留存、限流、滥用防护
5. 合规：生成式 AI 备案、数据出境评估

## 7. 与 `packages/` 的关系

`packages/`（opencode Electron IDE）保留为**本地/高级桌面形态**，不再承担云端主线；未来若把编码能力并入 workbench，把 opencode 作为 tool 接进 `apps/server`（P2）。
