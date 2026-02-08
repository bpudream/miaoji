/**
 * LLM 抽象层：统一多模型调用的接口与类型
 */

export type MessageRole = 'system' | 'user' | 'assistant';

export interface Message {
  role: MessageRole;
  content: string;
}

export interface ChatOptions {
  /** 模型名（部分 Provider 可覆盖配置） */
  model?: string;
  /** 温度等参数可在此扩展 */
  temperature?: number;
}

/**
 * 统一的 LLM 提供者接口
 * 支持 Ollama、DeepSeek/OpenAI 兼容 API 等
 */
export interface ILLMProvider {
  /**
   * 非流式对话补全，返回完整回复文本
   */
  chat(messages: Message[], options?: ChatOptions): Promise<string>;

  /**
   * 检查当前配置下服务是否可用（连接、鉴权等）
   */
  checkHealth(): Promise<boolean>;
}

/** 可选的流式接口，后续如需可在此扩展 */
export interface ILLMProviderStream extends ILLMProvider {
  chatStream?(messages: Message[], options?: ChatOptions): AsyncGenerator<string>;
}

/** 存储/API 使用的 LLM 配置 */
export type LLMProviderType = 'ollama' | 'openai';

export interface LLMConfig {
  provider: LLMProviderType;
  /** Ollama: host，如 http://localhost:11434 */
  base_url?: string;
  /** OpenAI/DeepSeek: API Key */
  api_key?: string;
  /** 模型名，如 qwen3:14b / deepseek-chat */
  model_name?: string;
  /** 翻译分块参数：单块目标 token 数（估算） */
  translation_chunk_tokens?: number;
  /** 翻译分块参数：上下文重叠 token 数（估算） */
  translation_overlap_tokens?: number;
  /** 翻译分块参数：上下文窗口 token 上限（估算） */
  translation_context_tokens?: number;
  /** 流式翻译批量大小（按句子数） */
  translation_stream_batch_size?: number;
  /** 流式翻译上下文行数（上一批末尾） */
  translation_stream_context_lines?: number;
}
