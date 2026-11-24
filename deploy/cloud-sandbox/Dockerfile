# syntax=docker/dockerfile:1.7
# ============================================================
# HyperCode 云端沙箱镜像（T1）
# 在现有 opencode CLI 镜像基础上，加开发工具链 + 非 root 用户
#
# 构建前置（见 README）：
#   1) 先构建 CLI 镜像并打 tag：
#        cd packages/cli && docker build -t hypercode-cli:latest .
#   2) 再构建本镜像：
#        docker build --build-arg CLI_IMAGE=hypercode-cli:latest \
#          -t hypercode-sandbox:latest deploy/cloud-sandbox/
# ============================================================

ARG CLI_IMAGE=hypercode-cli:latest
FROM ${CLI_IMAGE} AS cli

FROM alpine:3.20

# 运行时 + 开发常用工具（用户跑 agent 要用）
RUN apk add --no-cache \
      libgcc libstdc++ ripgrep \
      git openssh-client curl ca-certificates tini \
      nodejs npm \
      python3 py3-pip \
      build-base \
      bash jq unzip tar

# 复制已编译的 opencode 可执行文件
COPY --from=cli /usr/local/bin/opencode /usr/local/bin/opencode
RUN ln -sf /usr/local/bin/opencode /usr/local/bin/opencode2

# 非 root 沙箱用户（uid 固定，便于宿主卷权限）
RUN addgroup -g 10001 sandbox \
 && adduser -D -u 10001 -G sandbox -h /home/sandbox -s /bin/bash sandbox

# 关键：所有可变状态落在 /workspace/.hc（持久卷），以便 rootfs 可设为只读
ENV HOME=/workspace/.hc/home \
    XDG_CONFIG_HOME=/workspace/.hc/config \
    XDG_DATA_HOME=/workspace/.hc/data \
    XDG_CACHE_HOME=/workspace/.hc/cache \
    NPM_CONFIG_CACHE=/workspace/.hc/cache/npm \
    PIP_CACHE_DIR=/workspace/.hc/cache/pip \
    NODE_ENV=development \
    HC_WORKSPACE_ID=default

RUN mkdir -p /workspace/.hc/home /workspace/.hc/config /workspace/.hc/data /workspace/.hc/cache \
 && chown -R 10001:10001 /workspace

USER 10001:10001
WORKDIR /workspace

EXPOSE 4096

# 启动时由 launch-workspace.sh 追加参数：
#   --hostname 0.0.0.0 --port 4096 --cors <PWA_ORIGIN>
ENTRYPOINT ["tini","--","opencode","serve"]
