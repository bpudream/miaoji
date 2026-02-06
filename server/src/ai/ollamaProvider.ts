import type { ILLMProvider, Message, ChatOptions } from './interface';
import { Ollama } from 'ollama';

export interface OllamaProviderConfig {
  base_url?: string;
  model_name?: string;
}

export class OllamaProvider implements ILLMProvider {
  private client: Ollama;
  private model: string;

  constructor(config: OllamaProviderConfig = {}) {
    const host = config.base_url || 'http://localhost:11434';
    this.client = new Ollama({ host });
    this.model = config.model_name || 'qwen3:14b';
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.client.list();
      return true;
    } catch (error) {
      console.error('[OllamaProvider] checkHealth failed:', error);
      return false;
    }
  }

  async chat(messages: Message[], _options?: ChatOptions): Promise<string> {
    let system: string | undefined;
    const userParts: string[] = [];
    for (const m of messages) {
      if (m.role === 'system') {
        system = m.content;
      } else if (m.role === 'user') {
        userParts.push(m.content);
      }
      // assistant 在单轮总结中可不处理
    }
    const prompt = userParts.join('\n\n') || '';
    const request: any = {
      model: this.model,
      prompt,
      stream: false,
    };
    if (system) request.system = system;

    const response = await this.client.generate(request) as { response?: string };
    return response.response ?? '';
  }
}
