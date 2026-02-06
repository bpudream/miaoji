
# Sprint 03: 翻译引擎 (后端核心)

**Sprint 目标**：
在后端实现基于“滑动窗口”和“上下文感知”的长文本分块翻译逻辑，解决长视频翻译丢失语境的问题，并支持并发或串行调度。

**周期**：2026-02-20 ~ 2026-02-27
**状态**：待开始 (Pending)

**前置依赖**：Sprint-02 需完成「任务队列多类型支持」(US-2.0)，以便本 Sprint 将 `translate` 任务注册到同一套队列。参见 `docs/v3/v3-后端任务队列检查.md`。

---

## User Stories

### US-3.1 翻译数据存储设计

**作为** 开发者
**我想要** 设计支持多语言的数据库结构
**以便** 系统可以为一个视频存储“中文”、“英文”、“日文”等多版本的翻译结果。

**验收标准**:

* [ ] 创建 `translations` 表，关联 `transcription_id`，包含 `language` 和 `content` (JSON) 字段。
* [ ] 数据库迁移成功。

**任务拆解**:

* [ ] Task-3.1.1: 编写 Schema 迁移脚本，定义 Translation 模型。（估时：1h）(完成时间：**-**-____)

---

### US-3.2 上下文分块算法 (Context Chunking)

**作为** 系统
**我想要** 智能地将长篇转写结果切分为多个小块，并保留上下文
**以便** 发送给 LLM 时不会超出 Token 限制，且翻译连贯。

**验收标准**:

* [ ] 实现 `ChunkService`，支持按 Token 估算或句子数量切分。
* [ ] 切分逻辑支持 Overlap（重叠），即 Chunk N 包含 Chunk N-1 的最后几句作为 Context。
* [ ] 单元测试覆盖：确保没有句子遗漏或重复。

**任务拆解**:

* [ ] Task-3.2.1: 编写分块算法，输入 Whisper Segments，输出带有 Context 的 Prompt 列表。（估时：4h）(完成时间：**-**-____)

---

### US-3.3 翻译编排服务 (Translation Orchestration)

**作为** 系统
**我想要** 调用配置好的 LLM Provider (Sprint 1 产物) 执行翻译任务
**以便** 将分块的原文转换为目标语言并重新组装。

**验收标准**:

* [ ] `TranslationService` 能调用 `ILLMProvider`。
* [ ] 支持精心设计的 Prompt（包含角色设定、术语保持指令）。
* [ ] 能够处理 LLM 调用失败（重试机制）。
* [ ] 翻译完成后，结果写入数据库。

**任务拆解**:

* [ ] Task-3.3.1: 实现 Translation Prompt Template (提示词工程)。（估时：2h）(完成时间：**-**-____)
* [ ] Task-3.3.2: 实现核心循环逻辑：取块 -> 调 LLM -> 解析结果 -> 存库。（估时：4h）(完成时间：**-**-____)
* [ ] Task-3.3.3: 实现 `translate` 类型 Handler（调用 TranslationService），注册到队列并支持入队（如 `queue.add('translate', { transcription_id, target_language })`）；翻译结果写入 `translations` 表。（估时：1h）(完成时间：**-**-____)（依赖 Sprint-02 US-2.0）

---

## Sprint 03 总结

* **总估时**: 约 12 小时
* **关键交付物**:
* ✅ `translations` 数据库表
* ✅ 智能分块与上下文注入算法
* ✅ 后端翻译任务处理流（通过 Sprint-02 队列多类型能力入队执行）



---
