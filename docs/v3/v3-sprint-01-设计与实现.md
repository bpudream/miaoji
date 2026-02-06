# Sprint 01 可行性分析与设计

## 一、可行性分析

### 1. 现有代码结论
- **Ollama**：`server/src/services/ollama.ts` 已存在 `OllamaService`，具备 `ensureRunning`、`generate`、`getPrompts`，使用 `ollama` npm 包。
- **总结流程**：总结逻辑在 `app.ts` 的 `POST /api/projects/:id/summarize` 中，直接调用 `ollamaService`，无独立 SummaryService。
- **配置存储**：`settings` 表为 key-value（`key TEXT PRIMARY KEY`, `value TEXT`），可用单 key（如 `llm_config`）存 JSON，无需改表结构，仅需迁移脚本写入默认值。
- **前端设置**：`SettingsPage` 为 Tab 布局（系统状态、存储路径），可新增「AI 模型设置」Tab；当前无 `/api/settings`，需新增。

### 2. 结论
- **可行**：接口抽象、Ollama/OpenAI 双 Provider、配置持久化、前端设置与总结重构均在现有架构下可完成。
- **风险**：API Key 存本地 SQLite，仅适合本地/内网工具；若需更高安全可后续做加密或环境变量优先。

---

## 二、设计概要

### 1. 后端 AI 抽象层（`server/src/ai/`）
- **interface.ts**：`ILLMProvider` 含 `chat(messages: Message[], options?: ChatOptions): Promise<string>`、`checkHealth(): Promise<boolean>`；类型 `Message`、`ChatOptions`。
- **ollamaProvider.ts**：封装现有 Ollama 调用，实现上述接口。
- **openaiProvider.ts**：使用 `fetch` 调用 OpenAI 兼容接口（DeepSeek 等），Base URL 与 API Key 可配。
- **factory.ts**：`LLMFactory.create(config: LLMConfig)` 根据 `provider: 'ollama' | 'openai'` 返回对应实例。
- **prompts**：`getPrompts(text, mode)` 从 `ollama.ts` 抽离到 `ai/prompts.ts`，供总结流程与 Ollama 行为一致。

### 2. 配置存储与 API
- **存储**：`settings.key = 'llm_config'`，`value` 为 JSON：`{ provider, api_key?, base_url?, model_name? }`。API Key 在 GET 响应中脱敏（仅返回是否已设置或掩码）。
- **API**：`GET /api/settings` 返回所有可暴露配置（含脱敏的 llm_config）；`GET /api/settings/llm` 仅返回 LLM 配置；`POST /api/settings/llm` 更新 LLM 配置；`POST /api/settings/llm/test` 连接测试。
- **ConfigService**：从 db 读取 `llm_config`，提供 `getLLMConfig(): LLMConfig | null`，供总结接口与工厂使用。

### 3. 前端
- **设置页**：新增 Tab「AI 模型」，内嵌「AI 模型设置」卡片：Provider 下拉（Ollama / DeepSeek）、DeepSeek 时展示 API Key（掩码）、Model Name（默认 deepseek-chat）、连接测试按钮、保存。
- **API**：`getSettings()`, `getLLMSettings()`, `updateLLMSettings()`, `testLLMConnection()`。

### 4. 总结流程重构
- `POST /api/projects/:id/summarize`：通过 ConfigService 取 LLM 配置 → LLMFactory.create(config) → provider.checkHealth() → getPrompts() → provider.chat(messages) → 写库。异常时返回 503/500 及明确错误信息，不无限 loading。

---

## 三、实现清单（与 Sprint 01 任务对应）
- [x] Task-1.1.1: ai/interface.ts
- [x] Task-1.1.2: OllamaProvider
- [x] Task-1.1.3: OpenAIProvider
- [x] Task-1.1.4: LLMFactory + 单元测试
- [x] Task-1.2.x: settings 存储与 API、ConfigService
- [x] Task-1.3.x: 前端 LLMConfigCard 与对接
- [x] Task-1.4.x: 总结接口改用 LLMFactory，错误处理
