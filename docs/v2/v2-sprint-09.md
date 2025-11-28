# Sprint 09: 长文本智能切片总结优化 (Chunked Summary Enhancement)

**Sprint 目标**：
解决14B模型在处理长视频时总结质量差的问题。通过实现"智能切片 -> 分段提取 -> 全局聚合"的Map-Reduce流程，将长文本切分为2k-4k token的片段，分别提取关键信息后再汇总，显著提升长视频总结的信息密度和准确性。

**周期**：2024-12-XX ~ 2024-12-XX
**状态**：待开始 (Pending)

---

## 1. User Stories (用户故事)

### US-9.1 智能切片功能 (Smart Chunking)
**As a** 系统
**I want to** 根据Whisper时间戳和文本长度，在自然断句点（长停顿、句号）处智能切分文本
**So that** 每个切片保持在2k-4k token范围内，且不会打断逻辑连贯性，切片间保留10-15%重叠。

### US-9.2 分段提取功能 (Extract Phase)
**As a** 系统
**I want to** 对每个切片进行结构化信息提取（而非简单总结）
**So that** 能够保留高密度的关键信息点（决策点、待办事项、争议点等），避免信息在"传话游戏"中衰减。

### US-9.3 全局聚合功能 (Aggregate & Generate Phase)
**As a** 系统
**I want to** 将所有切片提取的信息点合并，再生成最终总结
**So that** 模型能够基于高密度干货建立全局关联，生成更准确、更完整的总结。

### US-9.4 切片总结配置与监控
**As a** 用户
**I want to** 能够配置切片参数（目标token数、重叠比例、停顿阈值），并查看切片处理进度
**So that** 我可以根据视频类型（会议/销售/教育）调整策略，并了解处理状态。

### US-9.5 转写流程交互优化 (Enhanced Transcription UX)
**As a** 用户
**I want to** 在上传文件后先确认配置选项，然后在专门的进度页面查看实时转写状态
**So that** 我可以控制转写参数，实时了解处理进度，并在需要时取消任务。

---

## 2. 任务清单 (Task List)

### US-9.1 智能切片功能

#### Task 9.1.1: 创建切片工具模块
- [ ] **文件**: `server/src/services/chunking.ts`
- [ ] **功能**: 实现 `smartSplitSegments` 函数（参考 `长文本切片总结.md` 中的TypeScript代码）
- [ ] **输入**: Whisper segments数组（包含start、end、text）
- [ ] **输出**: ChunkResult数组（包含id、text、startTime、endTime、tokenCountEstimate）
- [ ] **核心逻辑**:
  - 贪婪积累：不断添加segments直到达到目标token数（默认3000）
  - 智能回溯：在缓冲区后30%区域寻找最佳切分点（优先长停顿，其次句号）
  - 重叠处理：下一段起始点回退10-15%长度
- [ ] **配置参数**:
  - `targetTokenSize`: 目标每段token数（默认3000，推荐2500-3500）
  - `minTokenSize`: 最小允许长度（默认1000）
  - `overlapRatio`: 重叠比例（默认0.1，即10%）
  - `silenceThreshold`: 长停顿阈值，单位秒（默认1.5）

#### Task 9.1.2: Token估算函数优化
- [ ] **功能**: 实现或优化 `estimateTokens` 函数
- [ ] **要求**:
  - 针对中英文混合文本
  - 1个汉字 ≈ 0.6-0.8 token
  - 1个英文单词 ≈ 1.3 token
  - 简单按 1 char = 0.7 token 估算（兼顾Qwen tokenizer）
- [ ] **测试**: 验证估算准确度（可对比实际tokenizer结果）

#### Task 9.1.3: 单元测试
- [ ] **文件**: `server/tests/chunking.test.ts`
- [ ] **测试用例**:
  - 短文本（<1000 token）不切分
  - 长文本（>5000 token）正确切分
  - 验证重叠逻辑（相邻chunk有10-15%重叠）
  - 验证切分点选择（优先长停顿和句号）
  - 边界情况（空文本、单segment、极长segment）

### US-9.2 分段提取功能

#### Task 9.2.1: 扩展OllamaService支持提取模式
- [ ] **文件**: `server/src/services/ollama.ts`
- [ ] **功能**: 新增 `getExtractPrompt` 方法
- [ ] **输入**: 文本内容、场景类型（'meeting' | 'sales' | 'education' | 'general'）
- [ ] **输出**: 结构化的提取prompt和system prompt
- [ ] **提取策略**:
  - **会议场景**: 提取 [决策点]、[待办事项]、[争议点]、[关键数据]
  - **销售场景**: 提取 [客户痛点]、[价格敏感度]、[竞品提及]、[成交信号]
  - **教育场景**: 提取 [核心观点]、[案例说明]、[建议要点]
  - **通用场景**: 提取 [关键信息点]、[重要结论]、[行动项]
- [ ] **输出格式**: 要求模型输出结构化的信息点列表（JSON或Markdown列表），而非通顺短文

#### Task 9.2.2: 创建分段处理服务
- [ ] **文件**: `server/src/services/chunkProcessor.ts`
- [ ] **功能**: 实现 `processChunkExtraction` 方法
- [ ] **流程**:
  1. 接收ChunkResult数组
  2. 并发或串行调用OllamaService进行提取（考虑并发控制，避免过载）
  3. 收集所有提取结果（信息点列表）
  4. 返回提取结果数组
- [ ] **错误处理**:
  - 单个chunk失败不影响整体
  - 记录失败chunk的id和错误信息
  - 支持重试机制（可选）

#### Task 9.2.3: 数据库扩展 - 存储切片和提取结果
- [ ] **文件**: `server/src/db.ts`
- [ ] **新增表**: `summary_chunks`
  ```sql
  CREATE TABLE IF NOT EXISTS summary_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    summary_id INTEGER,              -- 关联到summaries表
    chunk_index INTEGER,             -- 切片序号
    text TEXT,                       -- 切片原始文本
    start_time REAL,                 -- 开始时间（秒）
    end_time REAL,                   -- 结束时间（秒）
    token_count INTEGER,             -- 预估token数
    extracted_content TEXT,          -- 提取的信息点（JSON格式）
    status TEXT DEFAULT 'pending',  -- pending, processing, completed, failed
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (summary_id) REFERENCES summaries(id)
  );
  ```
- [ ] **迁移逻辑**: 在initDb中添加表创建和列迁移逻辑

### US-9.3 全局聚合功能

#### Task 9.3.1: 实现聚合与生成服务
- [ ] **文件**: `server/src/services/chunkProcessor.ts`
- [ ] **功能**: 实现 `aggregateAndGenerate` 方法
- [ ] **流程**:
  1. 接收所有chunk的提取结果（信息点列表）
  2. 合并所有信息点，去重（可选）
  3. 按主题或时间顺序组织（可选）
  4. 生成聚合prompt（"基于以下信息点，生成完整总结"）
  5. 调用OllamaService生成最终总结
- [ ] **Prompt设计**:
  - System: 强调基于信息点生成，不要编造
  - User: 提供合并后的信息点列表 + 原始mode要求（brief/detailed/key_points）

#### Task 9.3.2: 重构总结API端点
- [ ] **文件**: `server/src/app.ts`
- [ ] **端点**: `POST /api/projects/:id/summarize`
- [ ] **逻辑重构**:
  1. 检测文本长度（估算token）
  2. 如果 < 2000 token：使用原有直接总结流程（向后兼容）
  3. 如果 >= 2000 token：使用切片流程
     - 获取segments（从transcription.content解析）
     - 调用smartSplitSegments切分
     - 调用processChunkExtraction提取
     - 调用aggregateAndGenerate生成最终总结
     - 保存summary和chunks到数据库
- [ ] **新增查询参数**:
  - `use_chunking`: boolean（默认true，长文本自动启用）
  - `chunk_target_tokens`: number（默认3000）
  - `chunk_overlap_ratio`: number（默认0.1）
  - `scene_type`: string（'meeting' | 'sales' | 'education' | 'general'，默认'general'）

#### Task 9.3.3: 新增切片状态查询API
- [ ] **文件**: `server/src/app.ts`
- [ ] **端点**: `GET /api/projects/:id/summary/chunks`
- [ ] **功能**: 返回指定summary的所有chunks及其处理状态
- [ ] **响应格式**:
  ```json
  {
    "summary_id": 1,
    "total_chunks": 5,
    "completed_chunks": 3,
    "failed_chunks": 0,
    "chunks": [
      {
        "id": 1,
        "chunk_index": 0,
        "start_time": 0.0,
        "end_time": 180.5,
        "token_count": 2850,
        "status": "completed",
        "extracted_content": "..."
      },
      ...
    ]
  }
  ```

### US-9.4 切片总结配置与监控

#### Task 9.4.1: 前端 - 总结配置选项
- [ ] **文件**: `web/src/pages/SettingsPage.tsx` 或 `web/src/components/SummaryPanel.tsx`
- [ ] **功能**: 添加切片总结配置UI
- [ ] **配置项**:
  - 启用/禁用切片总结（默认启用）
  - 目标token数滑块（2000-4000，默认3000）
  - 重叠比例滑块（5%-20%，默认10%）
  - 场景类型选择（会议/销售/教育/通用）
  - 停顿阈值（0.5-3.0秒，默认1.5秒）
- [ ] **存储**: 配置保存到localStorage或后端settings表

#### Task 9.4.2: 前端 - 切片处理进度显示
- [ ] **文件**: `web/src/components/SummaryPanel.tsx`
- [ ] **功能**:
  - 在生成总结时显示进度（"正在处理切片 3/5..."）
  - 显示每个chunk的状态（pending/processing/completed/failed）
  - 完成后显示切片统计信息（总切片数、平均token数等）
- [ ] **实现**:
  - 使用WebSocket或轮询查询 `/api/projects/:id/summary/chunks`
  - 显示进度条和状态列表

#### Task 9.4.3: 日志与监控
- [ ] **文件**: `server/src/services/chunkProcessor.ts`
- [ ] **功能**: 添加详细的日志记录
- [ ] **日志内容**:
  - 切片数量、平均token数、总token数
  - 每个chunk的处理时间
  - 提取结果的质量评估（信息点数量）
  - 聚合阶段的token数
  - 最终总结的token数
- [ ] **用途**: 用于性能分析和质量监控

### US-9.5 转写流程交互优化

#### Task 9.5.1: 文件上传后元数据解析
- [ ] **文件**: `server/src/app.ts`
- [ ] **端点**: `POST /api/upload` 修改
- [ ] **功能**:
  - 上传文件后，立即解析文件元数据（使用FFmpeg或前端MediaElement）
  - 返回文件信息：文件名、格式、大小、时长
  - 预估转写时间（时长 × 0.1，保守估计）
- [ ] **修改逻辑**:
  - 上传后不立即加入转写队列
  - 返回文件ID和元数据
  - 新增状态：`uploaded`（已上传，等待确认）

#### Task 9.5.2: 转写确认对话框组件
- [ ] **文件**: `web/src/components/TranscriptionConfirmDialog.tsx`
- [ ] **功能**: 创建确认对话框组件
- [ ] **显示内容**:
  - **文件信息卡片**:
    - 文件名、格式、大小
    - 时长（秒/分钟）
    - 预估转写时间
  - **配置选项**（可选，默认值）:
    - 语言选择（自动检测/手动选择，默认自动）
    - 场景类型（会议/销售/教育/通用，默认通用）- 用于后续总结
    - 是否启用智能切片（长视频自动启用，可手动关闭）
    - 切片参数（高级选项，可折叠）:
      - 目标token数（2000-4000，默认3000）
      - 重叠比例（5%-20%，默认10%）
      - 停顿阈值（0.5-3.0秒，默认1.5秒）
  - **操作按钮**:
    - "开始转写"（主要按钮，蓝色）
    - "取消"（次要按钮，灰色）
- [ ] **交互**:
  - 点击"开始转写"后调用API确认转写
  - 点击"取消"后删除已上传文件，返回上传页

#### Task 9.5.3: 转写确认API端点
- [ ] **文件**: `server/src/app.ts`
- [ ] **端点**: `POST /api/projects/:id/confirm-transcription`
- [ ] **功能**: 确认开始转写
- [ ] **请求体**:
  ```json
  {
    "language": "auto" | "zh" | "en" | ...,
    "scene_type": "meeting" | "sales" | "education" | "general",
    "enable_chunking": true,
    "chunk_config": {
      "target_tokens": 3000,
      "overlap_ratio": 0.1,
      "silence_threshold": 1.5
    }
  }
  ```
- [ ] **逻辑**:
  - 验证文件状态为 `uploaded`
  - 保存配置到数据库（新增 `transcription_config` 字段或单独表）
  - 将任务加入转写队列
  - 更新状态为 `pending`
- [ ] **返回**: `{ status: 'success', message: '转写已开始' }`

#### Task 9.5.4: 转写进度页面
- [ ] **文件**: `web/src/pages/TranscriptionProgressPage.tsx`
- [ ] **路由**: `/projects/:id/processing`
- [ ] **功能**: 显示转写实时进度
- [ ] **页面布局**:
  ```
  ┌─────────────────────────────────────┐
  │  ← 返回列表    项目名称              │
  ├─────────────────────────────────────┤
  │                                     │
  │  [大进度条] 45%                     │
  │  正在转写中...                      │
  │                                     │
  │  ┌─────────────────────────────┐   │
  │  │ 当前转写内容：                │   │
  │  │ "这是一段正在转写的文本..."    │   │
  │  └─────────────────────────────┘   │
  │                                     │
  │  阶段详情：                          │
  │  ✓ 音频提取完成 (2.3秒)            │
  │  ⏳ AI转写中... (45%)              │
  │  ⏸ 切片处理 (等待中)               │
  │                                     │
  │  [放弃任务] 按钮（红色，次要）      │
  └─────────────────────────────────────┘
  ```
- [ ] **显示内容**:
  - 总体进度条（0-100%）
  - 当前阶段文字说明
  - 当前转写句子（流式显示，不保留历史）
  - 阶段详情列表（音频提取、AI转写、切片处理）
  - 放弃任务按钮

#### Task 9.5.5: WebSocket/SSE实时通信
- [ ] **文件**: `server/src/app.ts` 和 `web/src/lib/websocket.ts` 或 `web/src/lib/sse.ts`
- [ ] **功能**: 实现实时进度推送
- [ ] **方案选择**:
  - **方案1**: WebSocket（推荐，双向通信）
  - **方案2**: Server-Sent Events（SSE，单向，简单）
  - **方案3**: 轮询（简单但不够实时，作为fallback）
- [ ] **后端实现**:
  - WebSocket端点：`/ws/projects/:id/transcription`
  - 推送事件类型：
    - `status_update`: 状态更新（extracting/transcribing/completed）
    - `progress_update`: 进度更新（百分比）
    - `segment_update`: 新转写句子（流式）
    - `chunk_update`: 切片处理进度（如果启用）
    - `error`: 错误信息
- [ ] **前端实现**:
  - 连接WebSocket/SSE
  - 监听事件并更新UI
  - 断线重连机制

#### Task 9.5.6: 流式转写显示支持
- [ ] **文件**: `server/python/worker.py` 和 `server/src/queue.ts`
- [ ] **功能**: 支持流式输出转写结果
- [ ] **实现**:
  - 修改Python Worker支持逐句输出（如果Whisper支持）
  - 或后端缓存segments，每N个segment推送一次
  - 通过WebSocket/SSE推送最新句子
- [ ] **前端显示**:
  - 只显示当前最新句子
  - 句子更新时平滑过渡动画
  - 不保留历史列表（按需求）

#### Task 9.5.7: 任务取消功能
- [ ] **文件**: `server/src/app.ts` 和 `server/src/queue.ts`
- [ ] **端点**: `POST /api/projects/:id/cancel-transcription`
- [ ] **功能**: 取消正在进行的转写任务
- [ ] **后端逻辑**:
  - 检查任务状态（必须是processing状态）
  - 停止Python Worker进程（如果正在运行）
  - 清理临时文件（提取的音频文件）
  - 更新数据库状态为 `cancelled`
  - 从队列中移除任务
- [ ] **前端实现**:
  - 在进度页显示"放弃任务"按钮
  - 点击后弹出确认对话框
  - 确认后调用取消API
  - 取消成功后返回项目列表页

#### Task 9.5.8: 转写完成统计卡片
- [ ] **文件**: `web/src/components/TranscriptionStatsCard.tsx`
- [ ] **功能**: 显示转写完成后的统计数据
- [ ] **显示内容**:
  - ✓ 转写完成图标
  - 总时长（15分32秒）
  - 转写字数（2,345 字）
  - 切片数量（如果启用，5 个）
  - 处理耗时（1分23秒）
  - 操作按钮：
    - "查看详情"（主要，跳转到详情页）
    - "返回列表"（次要）
- [ ] **集成**: 在进度页转写完成后自动显示

#### Task 9.5.9: 修改上传页流程
- [ ] **文件**: `web/src/pages/UploadPage.tsx`
- [ ] **功能**: 修改上传后的跳转逻辑
- [ ] **修改**:
  - 上传成功后不直接跳转到详情页
  - 先显示确认对话框（Task 9.5.2）
  - 用户确认后跳转到进度页（`/projects/:id/processing`）
  - 用户取消后停留在上传页

#### Task 9.5.10: 数据库扩展 - 转写配置存储
- [ ] **文件**: `server/src/db.ts`
- [ ] **功能**: 存储转写配置信息
- [ ] **方案1**: 在 `media_files` 表添加字段
  ```sql
  ALTER TABLE media_files ADD COLUMN transcription_config TEXT; -- JSON格式
  ```
- [ ] **方案2**: 新建 `transcription_configs` 表
  ```sql
  CREATE TABLE IF NOT EXISTS transcription_configs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_file_id INTEGER,
    language TEXT,
    scene_type TEXT,
    enable_chunking BOOLEAN,
    chunk_config TEXT, -- JSON格式
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (media_file_id) REFERENCES media_files(id)
  );
  ```
- [ ] **迁移逻辑**: 在initDb中添加表/字段创建逻辑

---

## 3. 技术实现细节

### 3.1 切片算法核心逻辑

参考 `docs/长文本切片总结.md` 中的实现：

1. **贪婪积累**: 不断添加segments直到达到 `targetTokenSize`
2. **智能回溯**: 在缓冲区后30%区域寻找最佳切分点
   - 优先级1: 长停顿（`pauseDuration >= silenceThreshold`，score += 100）
   - 优先级2: 句号/问号/感叹号（score += 50）
   - 优先级3: 逗号/分号（score += 10）
3. **重叠处理**: 从切分点向前回溯，凑够 `overlapRatio * targetTokenSize` 的token数

### 3.2 提取Prompt设计示例

**会议场景提取Prompt**:
```
请从以下会议录音转写文本中，提取结构化信息点。不要总结，只提取事实。

输出格式（JSON）:
{
  "decisions": ["决策点1", "决策点2"],
  "action_items": [{"who": "负责人", "what": "任务", "when": "时间"}],
  "disputes": ["争议点1", "争议点2"],
  "key_data": [{"metric": "指标名", "value": "数值"}]
}

文本内容：
{chunk_text}
```

### 3.3 聚合Prompt设计示例

**聚合生成Prompt**:
```
基于以下从长视频中提取的信息点，生成一份{mode}总结。

要求：
1. 基于信息点生成，不要编造不存在的内容
2. 建立信息点之间的关联
3. 按{mode}模式的要求组织内容

信息点列表：
{merged_extracted_points}

请生成总结：
```

### 3.4 并发控制

- 考虑14B模型的资源限制，建议：
  - 串行处理chunks（简单可靠）
  - 或限制并发数（如最多2个并发）
  - 添加请求队列避免过载

---

## 4. 验收标准 (Acceptance Criteria)

1. **切片质量**:
   - [ ] 长文本（>5000 token）被正确切分为多个2k-4k token的chunks
   - [ ] 切片边界在自然断句点（长停顿或句号），不会切断句子
   - [ ] 相邻chunks有10-15%的重叠内容

2. **提取质量**:
   - [ ] 每个chunk提取出结构化的信息点（而非通顺短文）
   - [ ] 信息点包含关键细节（决策、待办、数据等）
   - [ ] 不同场景类型使用对应的提取策略

3. **聚合质量**:
   - [ ] 最终总结基于所有信息点生成
   - [ ] 总结信息密度高，细节保留完整
   - [ ] 总结建立了全局关联，逻辑连贯

4. **性能**:
   - [ ] 切片处理时间 < 1秒（纯计算，无AI调用）
   - [ ] 单个chunk提取时间 < 30秒（取决于模型速度）
   - [ ] 聚合生成时间 < 60秒
   - [ ] 总处理时间相比直接总结增加 < 50%（考虑并发优化）

5. **向后兼容**:
   - [ ] 短文本（<2000 token）仍使用原有直接总结流程
   - [ ] 现有API接口保持兼容（新增可选参数）
   - [ ] 前端无需强制升级即可使用

6. **用户体验**:
   - [ ] 用户可以看到切片处理进度
   - [ ] 用户可以配置切片参数
   - [ ] 错误信息清晰，失败chunk可重试

7. **交互流程**:
   - [ ] 上传后显示确认对话框，用户可配置选项
   - [ ] 转写过程中有专门的进度页面
   - [ ] 实时显示当前转写句子（流式）
   - [ ] 显示各阶段进度（音频提取、转写、切片）
   - [ ] 用户可以取消正在进行的任务
   - [ ] 完成后显示统计信息，用户确认后进入详情页

---

## 5. 测试计划

### 5.1 单元测试
- [ ] `smartSplitSegments` 函数测试（各种边界情况）
- [ ] `estimateTokens` 函数测试（中英文混合）
- [ ] `processChunkExtraction` 测试（mock OllamaService）
- [ ] `aggregateAndGenerate` 测试（mock提取结果）

### 5.2 集成测试
- [ ] 端到端测试：上传长视频 -> 转写 -> 切片总结 -> 验证结果
- [ ] 测试不同场景类型（会议/销售/教育）
- [ ] 测试不同mode（brief/detailed/key_points）
- [ ] 测试错误处理（单个chunk失败、Ollama服务中断）

### 5.3 性能测试
- [ ] 测试不同长度文本的切片性能（1k/5k/10k/20k token）
- [ ] 测试并发处理vs串行处理的性能差异
- [ ] 测试内存占用（大量chunks）

### 5.4 质量对比测试
- [ ] 对比测试：直接总结 vs 切片总结
- [ ] 使用相同长视频，生成两种总结
- [ ] 人工评估：信息完整性、细节保留度、逻辑连贯性

### 5.5 交互流程测试
- [ ] 测试上传后确认对话框显示和交互
- [ ] 测试进度页实时更新（WebSocket/SSE）
- [ ] 测试流式句子显示
- [ ] 测试任务取消功能
- [ ] 测试完成后的统计卡片显示
- [ ] 测试移动端适配（进度页响应式布局）

---

## 6. 风险评估与应对

| 风险 | 概率 | 影响 | 应对措施 |
|------|------|------|---------|
| 切片算法在特殊情况下切分不当 | 中 | 中 | 充分测试边界情况，添加fallback逻辑 |
| 提取阶段信息点格式不统一 | 中 | 高 | 使用严格的JSON Schema验证，添加格式清洗逻辑 |
| 聚合阶段token数仍超限 | 低 | 高 | 对合并后的信息点再次切片（二级聚合） |
| 处理时间过长影响用户体验 | 中 | 中 | 实现进度反馈，考虑异步处理+WebSocket通知 |
| 14B模型并发处理能力不足 | 中 | 中 | 默认串行处理，添加配置选项控制并发数 |
| WebSocket连接不稳定 | 中 | 中 | 实现断线重连，提供轮询fallback |
| 流式显示性能问题 | 低 | 低 | 限制更新频率，使用防抖/节流 |
| 任务取消后资源清理不完整 | 中 | 中 | 完善清理逻辑，添加资源清理测试 |

---

## 7. 后续优化方向（Sprint 10+）

### 切片总结相关
- [ ] **二级聚合**: 如果信息点合并后仍超限，再次切片聚合
- [ ] **智能场景识别**: 自动识别视频类型，无需手动选择
- [ ] **提取结果缓存**: 相同chunk的提取结果可复用
- [ ] **增量更新**: 视频更新后，只重新处理变更的chunks
- [ ] **质量评估**: 自动评估提取和聚合质量，给出置信度分数
- [ ] **多模型对比**: 支持对比不同模型（如7B vs 14B）的总结质量

### 交互流程相关
- [ ] **批量上传**: 支持一次上传多个文件，批量处理
- [ ] **转写历史**: 保存转写历史记录，支持查看和对比
- [ ] **进度通知**: 转写完成后发送系统通知（浏览器通知API）
- [ ] **断点续传**: 支持转写中断后从断点继续
- [ ] **预览功能**: 在确认对话框预览文件（音频/视频播放器）

---

## 8. 参考资料

- `docs/长文本切片总结.md` - 详细的切片策略和实现代码
- `server/src/services/ollama.ts` - 现有的Ollama服务
- `server/src/app.ts` - 现有的总结API端点
- `server/python/worker.py` - Whisper转写结果格式

---

**预计工作量**:
- 切片总结功能：40-50 小时
- 交互流程优化：30-40 小时
- **总计**: 70-90 小时

**优先级**: 高（解决核心质量问题 + 提升用户体验）

