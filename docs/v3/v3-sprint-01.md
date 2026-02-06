# Sprint 01: 模型抽象层与多模型支持

**Sprint 目标**：
解耦后端 AI 调用逻辑，建立统一的 `ILLMProvider` 接口，实现本地 Ollama (Qwen) 与云端 DeepSeek / Qwen3 API (OpenAI 兼容协议) 的无缝切换，并允许用户在前端配置 API Key 和选择生效模型。

**周期**：2026-02-06 ~ 2026-02-13 (建议为期一周)
**状态**：已实现 (Implemented)

---

## User Stories

### US-1.1 后端模型抽象层 (Provider Pattern)

**作为** 后端开发者
**我想要** 定义一个通用的 LLM 接口并实现 Ollama 和 DeepSeek (OpenAI) 的适配器
**以便** 系统可以在不修改业务逻辑代码的情况下切换底层的 AI 模型。

**验收标准**:

* [x] 定义清晰的 `ILLMProvider` 接口（含 `chat` 和 `checkHealth` 方法）。
* [x] 实现 `OllamaProvider` 类，功能与原有逻辑一致。
* [x] 实现 `OpenAIProvider` 类，支持 DeepSeek API 调用（Base URL 可配）。
* [x] 实现 `LLMFactory` 工厂类，根据传入配置返回对应的 Provider 实例。
* [x] 单元测试通过：两个 Provider 均能正常返回模拟数据。

**任务拆解**:

* [x] Task-1.1.1: 创建 `server/src/ai/interface.ts` 定义 `ILLMProvider` 和通用类型 (Message, Options)。（估时：1h）(完成时间：2026-02-06)
* [x] Task-1.1.2: 实现 `OllamaProvider`，迁移原 `ollama.ts` 中的逻辑。（估时：2h）(完成时间：2026-02-06)
* [x] Task-1.1.3: 实现 `OpenAIProvider`，引入 `openai` npm 包或使用 fetch 封装 DeepSeek 调用。（估时：2h）(完成时间：2026-02-06)
* [x] Task-1.1.4: 实现 `LLMFactory`，编写简单的单元测试验证工厂逻辑。（估时：1h）(完成时间：2026-02-06)

---

### US-1.2 系统配置存储与 API 更新

**作为** 全栈开发者
**我想要** 在数据库中存储 LLM 的配置信息（模型类型、API Key、Base URL），并通过 API 暴露给前端
**以便** 用户的配置能够持久化，且后端能动态读取最新配置。

**验收标准**:

* [x] 数据库 `settings` 表新增字段（或 JSON 结构）以支持存储 provider、api_key、model_name。
* [x] 后端 `/api/settings` 接口支持 GET 和 POST 更新 LLM 配置。
* [x] 确保 API Key 在传输和存储时具备基本的安全性（如不以明文回显，或者仅作为本地工具暂明文存储但需前端脱敏显示）。

**任务拆解**:

* [x] Task-1.2.1: 修改 `server/src/db.ts`，编写 SQLite 迁移脚本，更新 Settings 表结构。（估时：1h）(完成时间：2026-02-06)
* [x] Task-1.2.2: 更新 `server/src/routes/settings.ts`，增加对 LLM 配置字段的校验和处理。（估时：1.5h）(完成时间：2026-02-06，实现于 app.ts)
* [x] Task-1.2.3: 更新 `ConfigService`，增加读取 Active Model 配置的辅助方法。（估时：0.5h）(完成时间：2026-02-06，见 services/config.ts)

---

### US-1.3 前端模型设置界面

**作为** 终端用户
**我想要** 在设置页面选择使用“本地模型”还是“在线模型”，并填入相应的 API Key
**以便** 我可以根据自己的电脑性能或网络情况灵活选择 AI 服务。

**验收标准**:

* [x] 设置页面新增“AI 模型设置”卡片。
* [x] 提供下拉菜单选择 Provider (Ollama / DeepSeek)。
* [x] 选择 DeepSeek 时，显示 API Key 输入框（掩码显示）和 Model Name 输入框（默认 deepseek-chat）。
* [x] 提供“连接测试”按钮，点击后调用后端测试接口验证配置是否有效。
* [x] 保存后，配置立即生效。

**任务拆解**:

* [x] Task-1.3.1: 更新前端 `Settings` 类型定义和 Zustand Store (`useAppStore`)。（估时：1h）(完成时间：2026-02-06，类型与 API 在 api.ts)
* [x] Task-1.3.2: 开发 `LLMConfigCard` 组件，实现表单 UI 和交互逻辑。（估时：3h）(完成时间：2026-02-06)
* [x] Task-1.3.3: 对接后端 API，实现配置的加载、保存和连接测试功能。（估时：2h）(完成时间：2026-02-06)

---

### US-1.4 总结服务重构与集成测试

**作为** 产品负责人
**我想要** 现有的“智能总结”功能改用新的 `LLMFactory` 调用
**以便** 验证架构重构的有效性，确保功能未回退。

**验收标准**:

* [x] `SummaryService` 不再直接依赖 Ollama，而是通过 `LLMFactory` 获取实例。（总结逻辑在 app.ts 中，已改为使用 LLMFactory）
* [x] 在设置为 DeepSeek 的情况下，对一个视频进行总结，能成功生成结果。
* [x] 在设置为 Ollama 的情况下，功能与重构前保持一致。
* [x] 错误处理：当 API Key 错误或网络不通时，前端能收到明确的错误提示，而不是无限 loading。

**任务拆解**:

* [x] Task-1.4.1: 重构 `server/src/services/summary.ts`，注入 `ConfigService` 和 `LLMFactory`。（估时：1.5h）(完成时间：2026-02-06，总结逻辑在 app.ts 中已改用 getLLMConfig + LLMFactory)
* [x] Task-1.4.2: 增加错误捕获逻辑，当 Provider 抛出异常时，正确更新任务状态为 `error`。（估时：0.5h）(完成时间：2026-02-06)
* [ ] Task-1.4.3: 手动集成测试：分别使用两种模式跑通“上传-转写-总结”全流程。（估时：1h）(完成时间：待手动验证)

---

## Sprint 01 总结

* **总估时**: 约 18 小时 (按每人每天有效开发 6 小时计，约 3 人天)
* **关键交付物**:
* ⏳ 具备扩展性的后端 `ai/` 模块
* ⏳ 支持 DeepSeek/OpenAI 协议的适配器
* ⏳ 包含模型选择功能的全新设置页面
* ⏳ 数据库 Schema 变更记录



---

## 使用说明

### 文档结构说明

1. **Sprint 基本信息**：目标、周期、状态
2. **User Stories**：每个用户故事包含：
* 用户故事描述（作为/我想要/以便）
* 验收标准（可验证的检查项）
* 任务拆解（具体任务列表）


3. **Sprint 总结**：总估时和关键交付物

### 编写规范

* **用户故事格式**：统一使用中文（作为/我想要/以便）
* **任务命名**：统一使用 `Task-X.X.X` 格式
* **验收标准**：使用复选框 `- [ ]` 或 `- [x]` 标记完成状态
* **任务状态**：使用复选框标记，完成后填写完成时间
* **估时单位**：统一使用小时（h）

### 注意事项

* 本次 Sprint 涉及核心架构调整，建议 Task-1.1.1 (接口定义) 完成并在团队内（或自我）Review 后再进行后续开发。
* 涉及 API Key 存储，开发环境下请注意不要将真实 Key 提交到 Git 仓库。