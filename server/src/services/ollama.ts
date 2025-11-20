import { Ollama } from 'ollama';

export type SummaryMode = 'brief' | 'detailed' | 'key_points';

interface OllamaConfig {
  host?: string;
  model?: string;
}

export class OllamaService {
  private client: Ollama;
  private model: string;

  constructor(config: OllamaConfig = {}) {
    this.client = new Ollama({ host: config.host || 'http://localhost:11434' });
    // Using a default model if not specified.
    // Note: User should ensure this model is pulled: `ollama pull qwen3:14b`
    this.model = config.model || 'qwen3:14b';
  }

  async ensureRunning(): Promise<boolean> {
    try {
      // Just try to list models to check connection
      await this.client.list();
      return true;
    } catch (error) {
      console.error('[Ollama] Service is not running or not accessible:', error);
      return false;
    }
  }

  async generate(prompt: string, systemPrompt?: string): Promise<string> {
    try {
      const request: any = {
        model: this.model,
        prompt: prompt,
        stream: false,
      };
      if (systemPrompt) request.system = systemPrompt;

      const response = await this.client.generate(request) as any;
      return response.response;
    } catch (error) {
      console.error('[Ollama] Generation failed:', error);
      throw error;
    }
  }

  async *generateStream(prompt: string, systemPrompt?: string): AsyncGenerator<string> {
    try {
      const request: any = {
        model: this.model,
        prompt: prompt,
        stream: true,
      };
      if (systemPrompt) request.system = systemPrompt;

      const stream = await this.client.generate(request) as any;

      for await (const part of stream) {
        yield part.response;
      }
    } catch (error) {
      console.error('[Ollama] Stream generation failed:', error);
      throw error;
    }
  }

  getPrompts(text: string, mode: SummaryMode): { prompt: string; system: string } {
    const system = `你是一个专业的会议助手和内容总结专家。请根据用户提供的转写文本，生成结构清晰、重点突出的总结。
请使用Markdown格式输出。`;

    let prompt = '';

    switch (mode) {
      case 'brief':
        prompt = `请对以下内容进行简要总结（200字以内），概括核心议题和结论：\n\n${text}`;
        break;
      case 'detailed':
        prompt = `请对以下内容进行详细总结。结构如下：\n1. 会议/内容概览\n2. 主要议题与讨论细节\n3. 结论与下一步行动\n\n内容如下：\n\n${text}`;
        break;
      case 'key_points':
        prompt = `请从以下内容中提取关键要点，以列表形式呈现。如果涉及具体任务、截止日期或责任人，请特别标注：\n\n${text}`;
        break;
      default:
        prompt = `请总结以下内容：\n\n${text}`;
    }

    return { prompt, system };
  }
}

export const ollamaService = new OllamaService();

