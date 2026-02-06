import type { ILLMProvider, Message, ChatOptions } from './interface';

export interface OpenAIProviderConfig {
  base_url: string;
  api_key: string;
  model_name?: string;
}

/**
 * OpenAI 兼容 API（DeepSeek / Qwen3 等）
 * 使用 fetch 调用 /v1/chat/completions
 */
const normalizeBaseUrl = (input: string): string => {
  const trimmed = input.trim();
  // 允许用户输入带 /v1 或不带 /v1 的地址
  const withoutV1 = trimmed.replace(/\/v1\/?$/i, '');
  return withoutV1.replace(/\/$/, '');
};

export class OpenAIProvider implements ILLMProvider {
  private baseUrl: string;
  private apiKey: string;
  private model: string;

  constructor(config: OpenAIProviderConfig) {
    this.baseUrl = normalizeBaseUrl(config.base_url);
    this.apiKey = config.api_key;
    this.model = config.model_name || 'deepseek-chat';
  }

  async checkHealth(): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/v1/models`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10000),
      });
      return res.ok;
    } catch (error) {
      console.error('[OpenAIProvider] checkHealth failed:', error);
      return false;
    }
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const model = options?.model ?? this.model;
    const url = `${this.baseUrl}/v1/chat/completions`;
    const body = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      stream: false,
      ...(options?.temperature != null && { temperature: options.temperature }),
    };
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${text}`);
    }
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  }
}
