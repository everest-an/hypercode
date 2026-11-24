# HyperCode 云端沙箱（T1 镜像 + T2 编排）

> 部署在 **Awareness 服务器**上，但作为**独立 compose project / 独立 docker 网络**运行，**不与 `awareness-box` 混网**。
> 面向**多租户**：一个 `workspaceId` = 一个隔离容器 + 一个持久卷。

## 目录

```
deploy/cloud-sandbox/
├─ Dockerfile            # T1 沙箱镜像（基于 opencode CLI 镜像 + 开发工具链）
├─ launch-workspace.sh   # T2 拉起一个租户沙箱（隔离/配额/卷/网络）
├─ stop-workspace.sh     # 停沙箱（保留卷，计费停）
├─ harden-egress.sh      # 封沙箱到私网的出站（宿主机 root 执行）
└─ README.md
```

> 脚本需 **LF 行尾**（Windows 拷贝过去先 `sed -i 's/\r$//' *.sh'` 或 `dos2unix`）。

---

## 1. 前置

| 项 | 要求 |
|---|---|
| Docker | ≥ 24（宿主机已有，Awareness 就在跑 docker） |
| gVisor(runsc) | **强烈建议安装**（增强隔离）；装不了会自动回退 runc 并告警 |
| 资源 | 建议专用：≥ 8 vCPU / 32GB；**给 awareness-box 预留足够 CPU/内存** |
| 密钥 | `/etc/hypercode/sandbox.env`（模型 key，不入 git） |

安装 gVisor（Debian/Ubuntu）：

```bash
curl -fsSL https://gvisor.dev/archive.key | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" \
  | sudo tee /etc/apt/sources.list.d/gvisor.list >/dev/null
sudo apt-get update && sudo apt-get install -y runsc
sudo runsc install          # 写入 docker 的 runtime 配置
sudo systemctl restart docker
docker info --format '{{json .Runtimes}}' | grep runsc && echo "gVisor OK"
```

`/etc/hypercode/sandbox.env` 示例（**别提交 git**）：

```
DEEPSEEK_API_KEY=sk-xxx
ZHIPU_API_KEY=xxx
GITHUB_TOKEN=            # 可选，P0 不用
```

---

## 2. 构建

> `packages/cli/Dockerfile` 会 **COPY `dist/cli-linux-<arch>-musl/bin/opencode`**，所以**必须先 `bun run build` 生成 dist**，否则 `docker build` 直接失败。
> 建议**在 Linux 服务器上构建**（跨平台产物由 bun 编译）。

```bash
# 2.0 依赖（monorepo 根）
bun install

# 2.1 生成 CLI 产物 -> packages/cli/dist/cli-<target>/bin/opencode
cd packages/cli
bun run build

# 2.2 构建 CLI 镜像（BuildKit 会按 TARGETARCH 自动选 build-amd64 / build-arm64）
docker build -t hypercode-cli:latest .

# 2.3 构建沙箱镜像
cd ../..
docker build --build-arg CLI_IMAGE=hypercode-cli:latest \
  -t hypercode-sandbox:latest deploy/cloud-sandbox/
```

> ARM 机器：`docker buildx build --platform linux/arm64 --load -t hypercode-cli:latest packages/cli/`（`--load` 才会进本地 images）。
> 只想产出多架构 OCI tar（推 registry/K8s）可用包内脚本：`bun run pack:docker`。

---

## 3. 部署到 Awareness 服务器

```bash
# 在服务器上
git clone <hypercode-repo> /opt/hypercode && cd /opt/hypercode
# 构建镜像(见 §2)
mkdir -p /srv/hypercode/workspaces
sudo ./deploy/cloud-sandbox/harden-egress.sh      # 首次(需先 launch 过一次建网络)
```

> 沙箱网络名 `hc-sandbox` 与 Awareness 的 `awareness-box_*` **完全独立**；容器名统一 `hc-ws-<id>`，不会撞。

---

## 4. 运行

```bash
# 起一个租户
sudo ./deploy/cloud-sandbox/launch-workspace.sh ws_demo
# 带仓库
sudo ./deploy/cloud-sandbox/launch-workspace.sh ws_demo https://github.com/xxx/repo.git

# 停（保留数据）
sudo ./deploy/cloud-sandbox/stop-workspace.sh ws_demo
```

沙箱内部地址：`http://hc-ws-ws_demo:4096`（仅 `hc-sandbox` 网络内可解析）。
对外由**网关（Caddy）**反代（T4），手机/PWA 不直连沙箱。

---

## 5. 与 Awareness 共存的隔离清单

| 层面 | 措施 |
|---|---|
| 网络 | 独立 docker 网络 `hc-sandbox`；**任何 awareness 容器不得接入** |
| 出站 | `harden-egress.sh` 封 10/8、172.16/12、192.168/16、169.254/16、100.64/10 |
| 计算 | 每租户 cgroup 配额（mem/cpus/pids）；`--read-only` rootfs |
| 权限 | 非 root（uid 10001）、`--cap-drop ALL`、`no-new-privileges`、独立 tmpfs |
| 数据 | 只挂 `/<卷根>/<workspaceId>:/workspace`，**绝不挂 Awareness 数据目录** |
| 密钥 | `/etc/hypercode/sandbox.env` 只读注入；不写盘、不进日志 |
| 资源争抢 | 主机给 awareness-box 预留 CPU/内存；沙箱 OOM 只杀自己 |

> **诚实提醒**：同机跑"任意用户代码"终归有上限。**P0 内部/种子可以；对外正式卖（HyperCode 上线）前必须拆到独立节点 + microVM**（见 §7）。

---

## 6. 多租户模型

- **租户标识**：`workspaceId`（建议 `ws_<ulid>`），贯穿容器名 `hc-ws-<id>`、卷路径、网络别名、标签 `hc.workspace`。
- **隔离**：一租户一容器一卷；配额可按下单档位调（`HC_MEM` / `HC_CPUS`）。
- **挂起**：`stop-workspace.sh` 停容器、留卷；下次 `launch` 直接复用卷（冷启秒级）。
- **多机扩展（P1）**：加一层 `workspace → node` 映射，各节点跑同一套脚本；Orchestrator 按节点派发。

---

## 7. 上线前 Gap（P1 必做）

| # | 事项 | 现状(P0) |
|---|---|---|
| 1 | 沙箱拆到**独立节点/裸金属** | 与 Awareness 同机（仅内部） |
| 2 | **Firecracker/Kata** microVM 级隔离 | gVisor（够用非顶配） |
| 3 | 出站**域名白名单代理**（替代 IP 级封锁） | 私网段 DROP |
| 4 | 鉴权桥（pair/connect 代管 token） | 未接（T5） |
| 5 | 计量（容器秒 + token） | 未接（T10） |
| 6 | 审计/日志留存 | 无 |
| 7 | 空闲自动停机 + 唤醒 | 手动 stop/launch |

---

## 8. 排障

```bash
docker logs hc-ws-<id> --tail 50
docker exec -it hc-ws-<id> sh -lc 'opencode --version; git --version; ls -la /workspace'
docker inspect hc-ws-<id> --format '{{.HostConfig.Runtime}} {{.HostConfig.Memory}} {{.HostConfig.NanoCpus}}'
iptables -L DOCKER-USER -n --line-numbers
```

常见：
- **`opencode serve` 立即退出** → 看 `docker logs`；多半是 `/workspace` 权限（宿主卷 uid 不是 10001）。
- **agent 连不上模型** → 检查 `sandbox.env` 是否挂上、出站是否被 `harden-egress` 误伤（模型域名是否公网）。
- **npm/pip 全局装失败** → rootfs 只读，属预期；请用本地安装（项目内 `node_modules` / venv）。
