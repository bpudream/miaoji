# 转写进度展示 - 可行性分析

## 一、现状

### 1.1 用户侧

- 项目详情页轮询 `GET /api/projects/:id`，根据 `status` 显示文案：
  - `extracting` →「正在提取音频...」
  - `transcribing` →「正在AI转写中...」
- **没有百分比或进度条**，用户无法知道转写完成大约还要多久。

### 1.2 服务端

- **queue.ts**：`handleTranscribe` 在提取完音频后把状态改为 `transcribing`，然后调用 `runPythonWorker(audioPath)`，**只传了音频路径**；收到 worker 一行 JSON 后写入转写结果并改为 `completed`。
- **worker.py**：`model.transcribe()` 返回的是 **生成器 (generator)**，当前实现是：
  ```python
  for segment in segments:
      result_segments.append({...})
  return { "segments": result_segments, ... }  # 全部跑完才返回
  ```
  即：**整段转写完成后才往 stdout 打一行 JSON**，Node 端也只期待「一条最终结果」。

### 1.3 faster-whisper 能力

- `transcribe()` 返回 `(segments, info)`，其中 `segments` 是**按段 yield 的生成器**，每段有 `segment.start`、`segment.end`、`segment.text`。
- 没有内置的「进度回调」参数，但我们可以**在循环里每产生一个 segment 就自己算进度并上报**。
- 进度可基于「已处理时间」：`segment.end` 表示当前已覆盖的音频时间（秒），若已知总时长 `duration`，则  
  `progress_pct = (segment.end / duration) * 100`。

---

## 二、结论：能否让用户看到转写进度？

**可以。** 需要做三件事：

1. **Worker**：在遍历 `segments` 时，每段（或每 N 段）向 stdout 输出一条「进度」JSON，而不是等全部完成才输出一条。
2. **Node**：解析 worker 的 stdout，区分「进度行」和「最终结果行」；把进度写入 DB 或内存，供 API 返回。
3. **API + 前端**：项目详情接口返回「转写进度」（如 0–100）；前端在 `status === 'transcribing'` 时展示进度条或「约 x%」。

---

## 三、实现要点

### 3.1 进度如何算

- **总时长**：Node 在提取音频后已有 `duration`（并已写入 `media_files.duration`），调用 worker 时**把 duration 一并传入**即可，例如：
  ```json
  { "id": 1, "audio_file": "/path/to/audio.wav", "duration": 125.5 }
  ```
- **当前进度**：Worker 里每得到一个 `segment`，用 `segment.end` 和传入的 `duration` 计算：
  - `pct = min(100, (segment.end / duration) * 100)`
  - 可做节流：例如每 5 个 segment 或每增加约 5% 再输出一条，避免刷屏。

### 3.2 Worker 协议扩展

- **当前**：stdout 只打一行最终结果：`{"id": req_id, "result": {...}}` 或 `{"id": req_id, "error": "..."}`。
- **扩展后**：
  - **进度行**（多行）：`{"type": "progress", "id": req_id, "progress_pct": 45.2}`（或再加 `current_time` 便于前端显示「已转写 1:02 / 2:05」）。
  - **最终行**（一行）：保持 `{"id": req_id, "result": ...}` 或 `{"id": req_id, "error": ...}`。
- Worker 逻辑：在 `for segment in segments` 里，每段（或按节流）先 `print(progress_line)` 并 `flush`，最后再 `print(result_line)`。

### 3.3 Node 端

- **传参**：`runPythonWorker(audioPath)` 改为传入 `{ audioPath, duration }`，payload 里带上 `duration`。
- **解析**：对 worker 的每一行 JSON：
  - 若 `message.type === 'progress'`：更新「当前任务」的进度（见下），**不** resolve/reject，**不** 清空 `pendingWorkerRequest`。
  - 若存在 `message.result` 或 `message.error`：按现有逻辑 resolve/reject，清空 `pendingWorkerRequest`。
- **进度存哪**：
  - **方案 A（推荐）**：在 `media_files` 表增加一列 `transcription_progress`（REAL，0–100 或 NULL）。Node 收到 progress 时 `UPDATE media_files SET transcription_progress = ? WHERE id = ?`。这样刷新/重进页面仍能看到进度，且实现简单。
  - **方案 B**：内存 Map<taskId, progress>。实现更快，但重启或单任务多实例时进度丢失，一般不推荐。

### 3.4 API

- `GET /api/projects/:id` 已返回 `status`、`duration`，只需**多返回** `transcription_progress`（0–100 或 null）。
- 当 `status === 'transcribing'` 时前端用该值展示进度；完成或失败后可将 `transcription_progress` 置为 NULL 或 100，避免歧义。

### 3.5 前端

- 轮询不变，仍用现有 `GET /api/projects/:id`。
- 当 `status === 'transcribing'` 且 `transcription_progress != null` 时：
  - 显示进度条：`<Progress value={transcription_progress} />`，或
  - 文案：「正在AI转写中... 约 45%」。
- 完成后可隐藏或清空进度条。

### 3.6 边界

- **无 duration**：老数据或极少数未写入 duration 时，可不传 duration，worker 只打 result 不打 progress；前端仅显示「正在AI转写中...」无百分比。
- **进度回退**：理论上 segment.end 可能因 VAD 等略有不单调，可对 progress_pct 做「只增不减」的 clamp，避免进度条倒退。
- **多任务**：当前是单 worker 串行处理，同一时刻只有一个任务在转写，一个 `transcription_progress` 列按 `id` 更新即可。

---

## 四、小结

| 问题 | 结论 |
|------|------|
| 能否让用户知道当前转写进度？ | **能**，通过「Worker 按 segment 上报进度 + Node 落库 + API 返回 + 前端展示」即可。 |
| 是否依赖 faster-whisper 官方进度 API？ | **不依赖**，库本身无进度回调，我们利用其 **segment 生成器** 在循环里自行计算并上报。 |
| 改动范围 | Worker（发 progress 行）、Node（传 duration、解析 progress、写 DB）、DB（可选新列）、API（返回 progress）、前端（展示进度）。 |

以上为分析与实现要点，未写具体代码，便于评审和排期。
