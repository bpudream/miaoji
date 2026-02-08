import db from '../db';
import type { LLMConfig } from '../ai/interface';

const LLM_CONFIG_KEY = 'llm_config';

const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: 'ollama',
  base_url: 'http://localhost:11434',
  model_name: 'qwen3:14b',
  translation_chunk_tokens: 1200,
  translation_overlap_tokens: 200,
  translation_context_tokens: 4096,
  translation_stream_batch_size: 5,
  translation_stream_context_lines: 3,
};

/**
 * 从数据库读取当前 LLM 配置（含明文 api_key，仅后端使用）
 */
export function getLLMConfig(): LLMConfig | null {
  try {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(LLM_CONFIG_KEY) as { value: string } | undefined;
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as LLMConfig;
    return parsed?.provider ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * 获取用于 API 响应的 LLM 配置（脱敏：不返回 api_key 明文，仅返回是否已设置）
 */
export function getLLMConfigForAPI(): (Omit<LLMConfig, 'api_key'> & { api_key_set?: boolean }) | null {
  const raw = getLLMConfig();
  if (!raw) return null;
  const { api_key, ...rest } = raw;
  return {
    ...rest,
    api_key_set: Boolean(api_key),
  };
}

/**
 * 更新 LLM 配置。若 api_key 为 undefined 则保留原值；空字符串表示清空。
 */
export function setLLMConfig(config: Partial<LLMConfig> & { provider: LLMConfig['provider'] }): void {
  const current = getLLMConfig() || { ...DEFAULT_LLM_CONFIG };
  const next: LLMConfig = { provider: config.provider };
  const baseUrl = config.base_url !== undefined ? config.base_url : current.base_url;
  if (baseUrl != null) next.base_url = baseUrl;
  const modelName = config.model_name !== undefined ? config.model_name : current.model_name;
  if (modelName != null) next.model_name = modelName;
  const chunkTokens =
    config.translation_chunk_tokens !== undefined
      ? config.translation_chunk_tokens
      : current.translation_chunk_tokens;
  if (chunkTokens != null) next.translation_chunk_tokens = chunkTokens;
  const overlapTokens =
    config.translation_overlap_tokens !== undefined
      ? config.translation_overlap_tokens
      : current.translation_overlap_tokens;
  if (overlapTokens != null) next.translation_overlap_tokens = overlapTokens;
  const contextTokens =
    config.translation_context_tokens !== undefined
      ? config.translation_context_tokens
      : current.translation_context_tokens;
  if (contextTokens != null) next.translation_context_tokens = contextTokens;
  const streamBatchSize =
    config.translation_stream_batch_size !== undefined
      ? config.translation_stream_batch_size
      : current.translation_stream_batch_size;
  if (streamBatchSize != null) next.translation_stream_batch_size = streamBatchSize;
  const streamContextLines =
    config.translation_stream_context_lines !== undefined
      ? config.translation_stream_context_lines
      : current.translation_stream_context_lines;
  if (streamContextLines != null) next.translation_stream_context_lines = streamContextLines;
  const apiKey = config.api_key !== undefined ? (config.api_key === '' ? undefined : config.api_key) : current.api_key;
  if (apiKey != null) next.api_key = apiKey;
  const value = JSON.stringify(next);
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).run(LLM_CONFIG_KEY, value);
}
