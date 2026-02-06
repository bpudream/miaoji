# Sprint 06 (Backlog): 容器化部署 (Dockerization)

**Sprint 目标**：
将后端（Node+Python+FFmpeg）与前端封装为 Docker 容器，通过 Docker Compose 实现一键启动。重点解决 Windows/Linux 环境差异，实现 GPU (CUDA) 在容器内的透传，确保应用可以在任何安装了 Docker 的 NVIDIA 显卡机器上运行。

**状态**：规划中 (Backlog) / 待执行 (Future)

---

## User Stories

### US-5.1 构建后端“全栈”镜像 (The Monolithic Image)

**作为** 运维/开发者
**我想要** 一个包含 Node.js、Python (CUDA支持) 和 FFmpeg 的单一 Docker 镜像
**以便** 我可以在容器内部继续使用 `child_process.spawn` 启动 Python Worker，而无需修改任何代码。

**验收标准**:

* [ ] 基于 `nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04` (或适配你 Whisper 版本的 Tag) 构建。
* [ ] 镜像内成功安装 Python 3.10+ 及 `requirements.txt` 依赖。
* [ ] 镜像内成功安装 Node.js 18+ (通过 nvm 或二进制拷贝)。
* [ ] 镜像内成功安装 FFmpeg。
* [ ] 容器启动后，Node 服务能正常运行，并能成功拉起 Python 子进程。

**任务拆解**:

* [ ] Task-5.1.1: 编写 `server/Dockerfile`。采用多阶段构建：先装 Python 依赖，再装 Node 环境，最后装 FFmpeg。（估时：4h）
* [ ] Task-5.1.2: 编写 `.dockerignore`，排除 `node_modules`、`venv`、`data` 等目录，减小镜像体积。（估时：0.5h）
* [ ] Task-5.1.3: 编写入口脚本 `entrypoint.sh`，处理数据库迁移 (`npm run migrate`) 后再启动服务。（估时：1h）

---

### US-5.2 前端构建与 Nginx 托管

**作为** 用户
**我想要** 一个轻量级的前端容器
**以便** 访问 Web 界面，且不用手动运行 `npm run dev`。

**验收标准**:

* [ ] 使用 Node 镜像进行构建 (Build Stage)。
* [ ] 使用 Nginx Alpine 镜像进行托管 (Production Stage)。
* [ ] Nginx 配置包含反向代理规则，将 `/api` 请求转发给后端容器。

**任务拆解**:

* [ ] Task-5.2.1: 编写 `web/Dockerfile`。（估时：1.5h）
* [ ] Task-5.2.2: 编写 `nginx.conf`，配置 SPA 路由重定向 (`try_files $uri /index.html`) 和 API 反向代理。（估时：1.5h）

---

### US-5.3 Docker Compose 编排与 GPU 透传

**作为** 用户
**我想要** 通过一个 `docker-compose up -d` 命令启动整个系统
**以便** 省去配置环境变量、挂载目录和启动显卡驱动的麻烦。

**验收标准**:

* [ ] `docker-compose.yml` 包含 `server` 和 `web` 两个服务。
* [ ] **GPU 透传成功**：后端容器能识别到宿主机的 NVIDIA 显卡 (需宿主机安装 `nvidia-container-toolkit`)。
* [ ] **数据持久化**：数据库文件 (`.db`) 和媒体文件 (`uploads/`) 挂载到宿主机目录，容器删除后数据不丢失。
* [ ] 环境变量 (`OLLAMA_HOST` 等) 可通过 `.env` 文件配置。

**任务拆解**:

* [ ] Task-5.3.1: 编写 `docker-compose.yml`，定义服务依赖、网络和 Volume 挂载。（估时：2h）
* [ ] Task-5.3.2: 配置 NVIDIA Runtime 支持 (`deploy.resources.reservations.devices`)。（估时：1h）
* [ ] Task-5.3.3: 处理宿主机与容器的通信问题 (如容器内访问宿主机运行的 Ollama)。(Linux 下用 `host.docker.internal` 需特殊配置)。（估时：1h）

---

### US-5.4 跨平台验证与文档

**作为** 开发者
**我想要** 验证部署脚本并获得操作文档
**以便** 我未来可以在新机器上快速复现部署。

**验收标准**:

* [ ] 验证 WSL2 (Windows) 环境下的 GPU 挂载是否正常。
* [ ] 验证 Linux (Ubuntu) 环境下的部署流程。
* [ ] 提供 `DEPLOY.md` 文档，说明前置要求（Docker Desktop / Nvidia Toolkit）。

**任务拆解**:

* [ ] Task-5.4.1: 在本地环境进行全流程测试，修复权限问题 (Permission Denied 常见于 SQLite/Uploads 挂载)。（估时：2h）
* [ ] Task-5.4.2: 编写部署文档。（估时：1h）

---

## Sprint 05 总结

* **总估时**: 约 15.5 小时
* **关键交付物**:
* ✅ `Dockerfile.server` (胖容器配置)
* ✅ `Dockerfile.web` (前端配置)
* ✅ `docker-compose.yml` (编排文件)
* ✅ `DEPLOY.md` (部署手册)



---

### 给开发者的备注 (Tips for Future You)

当你决定启动这个 Sprint 时，请注意以下几个“坑”：

1. **FFmpeg 版本**：`apt-get install ffmpeg` 安装的版本有时较老。如果之前用了太新的 FFmpeg 特性（比如某些滤镜），在 Docker 里可能报错，需要下载静态编译好的二进制文件放入 Docker。
2. **Ollama 连接**：
* 如果 Ollama 跑在宿主机（Windows/Mac），容器里访问它通常用 `http://host.docker.internal:11434`。
* 如果 Ollama 跑在 Linux 宿主机，Docker 默认网络下访问宿主机比较麻烦，可能需要 `--network host` 或者配置 IP。


3. **GPU 驱动**：Docker 容器里不需要装驱动，但**宿主机**必须装好 NVIDIA 驱动和 `nvidia-container-toolkit`。这是容器能用显卡的前提。
