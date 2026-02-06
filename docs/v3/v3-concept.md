这是一个非常扎实且务实的架构设计，特别适合“单机高性能”的场景。**你的核心优势在于“去网络化”的 IPC（进程间通信）设计**（Node 与 Python 通过 stdio 通信），这极大地降低了本地部署的复杂度和延迟，同时利用 SQLite 和文件系统做持久化，避免了引入 Redis/MySQL 等重型组件，非常符合“轻量级本地工具”的定位。

以下是对当前设计的评价，以及针对你提出的**视频字幕、本地 AI 翻译（长文本处理）、容器化及多模型支持**的架构演进建议。

---

### 第一部分：当前架构评价

**✅ 优点（Highlights）：**

1. **资源调度合理**：单例 Python Worker + 串行队列的设计，完美规避了显存（VRAM）爆炸的问题。在本地运行大模型（Whisper + LLM）时，资源竞争是最大的痛点，你的设计主动消除了并发风险。
2. **极简运维**：SQLite + 本地文件系统，使得数据迁移和备份非常简单（只需拷贝文件夹）。
3. **前后端分离清晰**：便于未来扩展，比如前端想做成 Electron 桌面应用，后端架构几乎不需要动。

**⚠️ 潜在风险/改进点：**

1. **Python Worker 的健壮性**：`stdio` 通信虽然快，但如果 Python 进程因某些 C++ 层的错误（如 CUDA 错误）崩溃，Node 端的错误捕获和自动重启机制需要非常完善，否则服务会“假死”。
2. **长任务阻塞**：虽然是串行，但如果一个长视频转写需要 1 小时，后续的短任务（如总结）会被阻塞。
* *建议*：可以将“转写任务”和“LLM 总结/翻译任务”拆分为两个优先级的队列，或者在 Python 侧实现简单的并发（Whisper 占 GPU，但 LLM 请求如果是走 API/Ollama，其实不占 Python 进程的计算资源，可以异步进行）。



---

### 第二部分：新功能架构演进设计

为了支持字幕生成、长视频翻译和多模型切换，我们需要对**后端服务层**和**AI 引擎层**进行升级。

#### 1. 字幕生成与合成 (Subtitle Generation & Burn-in)

这不仅是 AI 问题，更是工程问题。

* **流程设计**：
1. **SRT/VTT 生成（Node 层）**：Faster-Whisper 输出的结果包含精确的时间戳（Start/End）。不要在 Python 里拼字符串，直接把 JSON 返回给 Node。Node.js 处理字符串（格式化为 SRT）非常高效且灵活。
2. **字幕压制（AI/FFmpeg 层）**：如果用户需要“硬字幕”视频。
* 任务入队：`burn_subtitle`。
* 执行：Node 调用 FFmpeg（或通知 Python 调用）。
* **关键点**：字体处理。Windows/Linux/Docker 环境下字体路径完全不同，需要由 Node 层的 `ConfigService` 统一管理字体路径。





#### 2. 本地 AI 翻译与长视频处理 (Long Context Translation)

对于长视频，直接丢给 LLM 会导致：1. 超出上下文窗口；2. 丢失上下文连贯性；3. 幻觉。

**策略：基于滑动窗口的上下文分块翻译**

建议在 Node.js 层（`services/translation.ts`）实现以下逻辑，而不是在 Python 层，因为主要是文本处理和 API 调度：

* **Step 1: 智能分段**
* 不要按固定字符数切分，要按 **Whisper 的 Segment（句子/停顿）** 切分。
* 累计 Segment 直到达到 `Chunk Size`（例如 1000 token）。


* **Step 2: 上下文注入（Overlap）**
* 在发送给 LLM 翻译第 N 段时，将 **第 N-1 段的原文和译文** 作为 `System Prompt` 或 `Context` 传入。
* *Prompt 示例*：
```text
Context: (上一段的译文...)
Task: Translate the following text strictly, maintaining the tone and terminology of the context.
Input: (当前段原文...)

```




* **Step 3: 异步并发 vs 串行**
* 为了速度，可以并发翻译不同的 Chunk（如果不强依赖上下文）。
* 为了质量，建议串行，利用上文信息。



#### 3. API 与本地小模型多支持 (Model Abstraction Layer)

你需要一个统一的 **LLM 适配器模式（Adapter Pattern）**。

* **接口定义 (`ILLMProvider`)**：
```typescript
interface ILLMProvider {
  chat(messages: Message[], options?: IllmOptions): Promise<string>;
  // 支持流式输出更好
  chatStream(messages: Message[], options?: IllmOptions): AsyncIterable<string>;
}

```


* **实现类**：
* `OllamaProvider`: 调用本地 Ollama API。
* `OpenAIProvider`: 兼容 DeepSeek API、ChatGPT、Claude 等。
* `LocalPythonProvider`: 如果你想在那个常驻的 Python Worker 里加载一个小模型（如 `nllb-200` 专门做翻译），则走 stdin/stdout 通道。


* **配置策略**：
* 在 `settings` 表中增加配置。用户可以为“总结”选一个模型（如 Qwen3-14B），为“翻译”选另一个模型（如 DeepSeek V3 API）。



---

### 第三部分：容器化部署 (Docker Support)

将 Windows 主机环境迁移到 Docker 是最大的挑战，主要是 GPU 的透传。

**Dockerfile 设计思路**：

由于你的应用既包含 Node.js 又包含 Python (CUDA)，建议使用 **“胖容器” (Monolithic Container)** 或者 **Docker Compose 分离**。考虑到本地部署的便捷性，**Docker Compose** 是最优解。

**方案：Docker Compose 编排**

```yaml
version: '3.8'

services:
  # 1. 核心应用服务 (Node + Python Worker)
  miaoji-app:
    build: .
    image: miaoji-server:latest
    runtime: nvidia  # 关键：启用 NVIDIA Runtime
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - OLLAMA_HOST=http://host.docker.internal:11434 # 连接宿主机 Ollama
    volumes:
      - ./data:/app/data         # 映射数据目录
      - ./models:/app/models     # 映射 Whisper 模型目录
    ports:
      - "3000:3000"
    depends_on:
      - miaoji-frontend

  # 2. 前端服务 (Nginx)
  miaoji-frontend:
    image: miaoji-web:latest
    ports:
      - "80:80"

  # 3. (可选) 如果不想用宿主机 Ollama，可以跑在容器里
  # ollama:
  #   image: ollama/ollama
  #   ...

```

**关键技术点**：

1. **Base Image**：后端镜像建议基于 `nvidia/cuda:11.8.0-cudnn8-runtime-ubuntu22.04`。
2. **多阶段构建**：
* 先安装 Python 环境和 torch/whisper。
* 再安装 Node.js (通过 nvm 或直接拷贝二进制)。
* 这样可以保证环境统一。


3. **FFmpeg**：在 Dockerfile 中通过 `apt-get install ffmpeg` 安装，保证版本可控。

---

### 第四部分：升级后的架构图

```mermaid
graph TD
    subgraph Client [客户端层]
        Browser[浏览器 (React SPA)]
    end

    subgraph DockerHost [Docker 容器环境 / 宿主机]
        Nginx[Nginx (反向代理)]

        subgraph AppContainer [后端服务容器]
            NodeService[Node.js Fastify]
            Queue[任务队列 (SQLite持久化)]

            subgraph Services [内部服务]
                SubtitleGen[字幕生成 (SRT/ASS)]
                TransService[翻译编排 (分块/上下文)]
            end

            PythonWorker[Python Worker (常驻进程)]
            Whisper[Faster-Whisper (ASR)]
            LocalTrans[本地翻译模型 (可选 NLLB)]
        end

        FileSys[(本地文件系统 / Data Volume)]
        SQLite[(SQLite DB)]
    end

    subgraph ExternalAI [模型层]
        Ollama[Ollama 服务 (Qwen/Llama)]
        CloudAPI[云端 API (DeepSeek/OpenAI)]
    end

    %% Data Flow
    Browser -->|HTTP/Upload| Nginx
    Nginx -->|Proxy| NodeService

    NodeService -->|Read/Write| SQLite
    NodeService -->|Save| FileSys

    %% Task Flow
    NodeService -->|Push| Queue
    Queue -->|Pop| PythonWorker
    Queue -->|Call| TransService

    %% AI Processing
    PythonWorker -->|STDIN/OUT| NodeService
    PythonWorker -->|Load| Whisper

    %% Translation & Summary Flow
    TransService -->|HTTP| Ollama
    TransService -->|HTTP| CloudAPI

    %% Video Processing
    NodeService -->|Exec| FFmpeg[FFmpeg (视频处理/压制)]

```

### 总结与下一步建议

你的项目现在的底子非常好。引入翻译和容器化后，架构的主要变化是：

1. **Node 层变厚了**：它不再只是简单的 API 网关，而是承担了“翻译编排（Orchestration）”和“字幕处理”的逻辑。
2. **模型层解耦**：从硬编码调用 Ollama 变成策略模式，支持多种后端。

**下一步行动建议：**

1. **优先实现模型抽象层 (`ILLMProvider`)**：这是支持翻译和多模型的基础。先让系统能灵活切换 Qwen 本地版和 DeepSeek 在线版。
2. **实现 SRT 导出**：这是低成本高感知的 update。在 Node 端把数据库里的 transcription JSON 转成 SRT 文本并通过 API 提供下载。
3. **Docker 环境验证**：先在 Linux 机器上跑通 `nvidia-container-toolkit`，这是容器化部署最容易卡壳的地方。
