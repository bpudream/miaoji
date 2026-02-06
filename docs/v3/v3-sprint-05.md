# Sprint 05: 任务调度中心与可观测性

**Sprint 目标**：
将内存队列升级为**持久化作业系统 (Persistent Job System)**，实现任务的全生命周期管理。提供可视化的任务看板，允许用户查看任务的详细 Payload、AI 交互日志（Prompt/Response），并支持失败任务的断点重试。

**周期**：1 周 (建议在 Sprint 04 之后)
**状态**：规划中

**前置依赖**：S01 模型抽象层、S02 队列多类型、S03 翻译引擎（TranslationService）、S04 翻译前端。详见 `docs/v3/v3-规划合理性检查-S05.md`。

---

## User Stories

### US-5.1 任务持久化与状态机 (Job Persistence)

**作为** 系统
**我想要** 将所有异步任务写入数据库的 `jobs` 表
**以便** 即使服务器重启，任务记录也不会丢失，且能记录任务开始、结束时间和错误堆栈。

**验收标准**:

* [ ] 数据库新增 `jobs` 表，核心字段：`id`, `type` (transcribe/translate/burn), `status` (pending/processing/completed/failed), `payload` (JSON), `result` (JSON), `logs` (JSON array), `created_at`, `started_at`, `finished_at`。
* [ ] 改造 `Queue` 类：入队时写库，处理时更新状态，完成后回写结果。
* [ ] 启动恢复机制：服务器启动时，自动扫描 `processing` 状态的任务并重置为 `pending` (或标记为 crashed)。

**任务拆解**:

* [ ] Task-5.1.1: 设计 `jobs` 表 Schema 并编写 SQLite 迁移脚本。（估时：1.5h）
* [ ] Task-5.1.2: 重构 `server/src/queue.ts`，从纯内存数组改为读写 SQLite。（估时：3h）
* [ ] Task-5.1.3: 实现“僵尸任务”检测与恢复逻辑（处理服务器意外崩溃的情况）。（估时：1h）

---

### US-5.2 AI 交互链路追踪 (AI Traceability)

**作为** 开发者/高级用户
**我想要** 在任务详情中看到发送给 AI 的完整 Prompt 和 AI 返回的原始数据
**以便** 我能调试翻译质量问题，或者对比不同模型的表现。

**验收标准**:

* [ ] 扩展 `ILLMProvider` 接口，支持传入 `jobId` 上下文。
* [ ] 在 `TranslationService` 和 `SummaryService` 中，调用 LLM 前记录 Prompt 到 `jobs.logs`，收到回复后记录 Response。
* [ ] 支持记录 Token 消耗量（如果 API 返回）。

**任务拆解**:

* [ ] Task-5.2.1: 更新 `JobLogger` 工具类，支持向特定 Job 追加结构化日志。（估时：1h）
* [ ] Task-5.2.2: 埋点：在 `TranslationService` 的分块翻译循环中，注入日志记录代码。（估时：1.5h）
* [ ] Task-5.2.3: 埋点：在 `Python Worker` 的回调中，将 Whisper 的进度/日志转发给 Node 端并写入 Job。（估时：1.5h）

---

### US-5.3 任务管理看板 (Task Dashboard)

**作为** 管理员
**我想要** 一个独立的“系统状态”页面
**以便** 监控当前队列长度，查看历史任务详情，并对失败任务进行重试。

**验收标准**:

* [ ] 前端新增 `/system/jobs` 页面。
* [ ] **列表视图**：显示所有任务，支持按类型（翻译/转写）和状态（成功/失败）筛选。
* [ ] **详情抽屉**：点击任务，右侧弹出详情，展示 JSON Payload 和 Timeline 日志。
* [ ] **操作**：
* [ ] 重试 (Retry)：复制原任务 Payload 重新入队。
* [ ] 取消 (Cancel)：如果任务正在运行，尝试终止（需后端支持）。
* [ ] 删除 (Delete)：清理历史记录。



**任务拆解**:

* [ ] Task-5.3.1: 后端实现 `/api/jobs` CRUD 接口及 `/api/jobs/:id/retry` 接口。（估时：2h）
* [ ] Task-5.3.2: 前端开发 `JobsTable` 组件，包含状态徽标 (Badge) 和过滤器。（估时：3h）
* [ ] Task-5.3.3: 前端开发 `JobDetailDrawer` 组件，使用 `<pre>` 或 JSON Viewer 展示复杂的 Prompt 和 Result。（估时：2.5h）

---

## Sprint 05 总结

* **总估时**: 约 17 小时
* **关键交付物**:
* ✅ `jobs` 数据库表 (任务仓库)
* ✅ 系统任务看板 UI
* ✅ AI "黑盒" 可视化 (Prompt/Response 日志)



---

### V3 Sprint 路线图（统一版）

1. **S01 (基础)**: 模型解耦 (让系统能跑 DeepSeek)。
2. **S02 (基础)**: 队列多类型支持 (后端逻辑) + 字幕导出。  
   *注：S02 只需代码层支持 `type` 区分即可，不需要做复杂的数据库持久化。*
3. **S03 (核心)**: 翻译后端 (复杂的长任务)。
4. **S04 (核心)**: 翻译前端。
5. **S05 (增强)**: **任务调度中心 (本 Sprint)**。  
   *此时已有翻译/转写等任务，引入看板与持久化的时机合适。*
6. **S06 (基建 / Backlog)**: Docker 容器化 / RAG / 其他功能。  
   *参见 `v3-sprint-99容器化.md`，执行时机待定。*