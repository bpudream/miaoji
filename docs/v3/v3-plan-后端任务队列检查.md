# V3 后端任务队列设计检查

**检查日期**：2026-02-06  
**结论**：当前队列为**单类型、内存、写死流程**，**不能**直接支持 Sprint-03 的「翻译任务队列」；建议在 **Sprint-02** 完成「任务队列多类型抽象」，Sprint-03 仅做「注册 translate 任务」。

---

## 1. 当前队列实现摘要

| 维度 | 现状 |
|------|------|
| **实现位置** | `server/src/queue.ts` |
| **任务类型** | 仅一种：`{ id: string, filepath: string }`（转写任务） |
| **存储** | 内存数组 `Task[]`，无持久化，重启丢失 |
| **处理逻辑** | 写死：提取音频 → 转写(Python Worker) → 写 `transcriptions`、更新 `media_files.status` |
| **状态存储** | 仅更新 `media_files` 表（status / error_message / failed_stage 等） |
| **调用点** | 上传完成后 `queue.add(fileId, finalFilePath)`；重试时同上 |

因此：

- 没有「任务类型」概念，无法区分转写 / 翻译 / 字幕压制。
- 没有「翻译任务」的 payload（如 `transcription_id`、`target_language`）。
- 翻译进度/排队状态没有独立存储（Sprint-03 会新增 `translations` 表，但任务本身的排队与状态尚未设计）。

---

## 2. V3 计划中的队列需求

- **Sprint-02**  
  - Task-2.2.3：更新 Queue 逻辑，支持 **`burn_subtitle`** 类型任务。（估时 1.5h）
- **Sprint-03**  
  - Task-3.3.3：**注册 `translate` 任务到队列系统**。（估时 1h）

两处都依赖「队列能接受并分发多种任务类型」。若不在更早的 Sprint 做抽象，Sprint-02 和 Sprint-03 会各自改 Queue，容易重复劳动且估时不足。

---

## 3. 建议方案：在 Sprint-02 完成队列多类型抽象

- **在 Sprint-02 中**增加（或扩展现有 Task-2.2.3 为）一个 **User Story：任务队列多类型支持**，使队列具备：
  - **任务类型**：如 `transcribe` | `burn_subtitle` | `translate`。
  - **统一入队接口**：例如 `queue.add(type, payload)`，payload 按类型不同（如转写用 `{ id, filepath }`，翻译用 `{ transcription_id, target_language }`）。
  - **按类型分发**：根据 `type` 调用对应 Handler（转写沿用现有逻辑，`burn_subtitle` 调用 FFmpeg，`translate` 在 Sprint-03 再实现）。
- **Sprint-03** 只做：
  - 实现 `TranslationService` + 翻译编排逻辑；
  - **注册** `translate` 类型的 Handler 并支持入队（例如 `queue.add('translate', { transcription_id, target_language })`）；
  - 翻译结果写入 `translations` 表；如需「翻译任务状态」可在此 Sprint 增加最小字段或复用现有表。

这样：

- Sprint-02 一次做完「多类型队列 + burn_subtitle」，Sprint-03 的「注册 translate 任务」估时 1h 更合理。
- 避免 Sprint-03 同时做「队列大改 + 翻译逻辑」导致膨胀。

---

## 4. 是否膨胀 Sprint 的结论

- **Sprint-03 单独膨胀**（在 Sprint-03 内做队列多类型 + 翻译）：不推荐。  
  Sprint-03 会过重，且 Sprint-02 的 `burn_subtitle` 仍需改队列，会变成先临时 if/else 再在 Sprint-03 重构。
- **推荐**：**膨胀 Sprint-02**，在 Sprint-02 中完成「任务队列多类型抽象」+ 现有「字幕压制」需求；Sprint-03 仅依赖该能力并实现「翻译任务注册与执行」，必要时在 Sprint-03 微调估时（例如 Task-3.3.3 保持 1h，若发现需增加「翻译任务状态」查询可再加 0.5~1h）。

---

## 5. 后续可选的队列增强（非必须在 V3 内完成）

- **任务持久化**：将待执行任务写入 SQLite（如 `jobs` 表），重启后可恢复排队（当前仅内存即可满足多数场景）。
- **任务状态表**：若需统一查询「转写中 / 翻译中 / 压制中」，可引入 `job_id` 或在各业务表上增加 `status` 字段（如翻译任务状态可放在 `translations` 或单独小表）。
- **优先级/多队列**：v3-concept 提到的「转写与 LLM 任务分队列」可在多类型稳定后再做。

以上可在 Sprint-02/03 完成后按需迭代。
