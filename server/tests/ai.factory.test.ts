import { describe, it, expect } from 'vitest';
import { LLMFactory } from '../src/ai/factory';
import { OllamaProvider } from '../src/ai/ollamaProvider';
import { OpenAIProvider } from '../src/ai/openaiProvider';

describe('LLMFactory', () => {
  it('create(null) returns null', () => {
    expect(LLMFactory.create(null)).toBeNull();
  });

  it('create({ provider: "ollama" }) returns OllamaProvider', () => {
    const p = LLMFactory.create({ provider: 'ollama' });
    expect(p).toBeInstanceOf(OllamaProvider);
  });

  it('create({ provider: "ollama", base_url, model_name }) returns OllamaProvider with config', () => {
    const p = LLMFactory.create({
      provider: 'ollama',
      base_url: 'http://127.0.0.1:11434',
      model_name: 'qwen3:7b',
    });
    expect(p).toBeInstanceOf(OllamaProvider);
  });

  it('create({ provider: "openai" }) without api_key returns null', () => {
    expect(LLMFactory.create({ provider: 'openai' })).toBeNull();
  });

  it('create({ provider: "openai", api_key: "sk-xxx" }) returns OpenAIProvider', () => {
    const p = LLMFactory.create({
      provider: 'openai',
      api_key: 'sk-test',
      base_url: 'https://api.deepseek.com',
      model_name: 'deepseek-chat',
    });
    expect(p).toBeInstanceOf(OpenAIProvider);
  });
});
