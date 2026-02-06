import type { ILLMProvider, LLMConfig } from './interface';
import { OllamaProvider } from './ollamaProvider';
import { OpenAIProvider } from './openaiProvider';

/**
 * 根据配置创建对应的 LLM Provider 实例
 */
export class LLMFactory {
  static create(config: LLMConfig | null): ILLMProvider | null {
    if (!config || !config.provider) return null;
    switch (config.provider) {
      case 'ollama': {
        const opts: { base_url?: string; model_name?: string } = {};
        if (config.base_url) opts.base_url = config.base_url;
        if (config.model_name) opts.model_name = config.model_name;
        return new OllamaProvider(opts);
      }
      case 'openai':
        if (!config.api_key) return null;
        return new OpenAIProvider({
          base_url: config.base_url || 'https://api.deepseek.com',
          api_key: config.api_key,
          ...(config.model_name && { model_name: config.model_name }),
        });
      default:
        return null;
    }
  }
}
