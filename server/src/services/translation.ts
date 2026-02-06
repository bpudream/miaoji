import db from '../db';
import { getLLMConfig } from './config';
import { LLMFactory } from '../ai/factory';
import { compress, decompress, type Segment } from './chunking';
import { logger } from '../utils/logger';

const DEFAULT_TARGET_LANG = 'en';
const MAX_RETRIES = 2;
/** 保守估计：超过此字符数时 Ollama 等短上下文模型易截断 */
const COMPRESSED_LENGTH_GUARD = 4000;

function parseSegmentsFromTranscription(content: string, format: string): Segment[] {
  let parsed: any;
  try {
    parsed = format === 'json' ? JSON.parse(content) : { text: content };
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) {
    return parsed.map((s: any) => ({ start: s.start, end: s.end, text: s.text ?? '' }));
  }
  if (parsed?.segments && Array.isArray(parsed.segments)) {
    return parsed.segments.map((s: any) => ({
      start: s.start,
      end: s.end,
      text: s.text ?? '',
    }));
  }
  if (typeof parsed?.text === 'string') {
    return [{ text: parsed.text }];
  }
  return [];
}

/**
 * 翻译流程：Load JSON -> Compress -> LLM -> Decompress -> Save JSON
 */
export async function runTranslation(mediaFileId: string, targetLanguage: string): Promise<void> {
  const transRow = db.prepare('SELECT id, content, format FROM transcriptions WHERE media_file_id = ?').get(mediaFileId) as
    | { id: number; content: string; format: string }
    | undefined;
  if (!transRow) {
    throw new Error('Transcription not found for this project');
  }

  const segments = parseSegmentsFromTranscription(transRow.content, transRow.format);
  if (segments.length === 0) {
    throw new Error('No segments to translate');
  }

  const lang = targetLanguage || DEFAULT_TARGET_LANG;
  const config = getLLMConfig();
  const provider = config ? LLMFactory.create(config) : null;
  if (!provider) {
    throw new Error('LLM not configured');
  }

  const compressed = compress(segments);
  if (config && compressed.length > COMPRESSED_LENGTH_GUARD && config.provider === 'ollama') {
    throw new Error(
      '视频内容过长，当前使用的本地模型上下文有限，可能无法完整翻译。请到「设置 - AI 模型」中切换到支持长上下文的在线模型（如 DeepSeek）后再试。'
    );
  }

  const systemPrompt = `You are a professional subtitle translator.
Translate the following text lines into ${lang}.
Strictly follow this format for each line:
[ID] <Translated Text>

Rules:
1. Keep the [ID] exactly as in the input.
2. Do not merge or split lines.
3. Only output the translated lines, no explanations.
4. If a line is just a symbol or meaningless, keep it as is.`;

  const userPrompt = `Input:\n${compressed}`;
  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userPrompt },
  ];

  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const raw = await provider.chat(messages);
      const translatedSegments = decompress(segments, raw);
      const content = JSON.stringify({ segments: translatedSegments });
      db.prepare(
        `INSERT INTO translations (transcription_id, language, content) VALUES (?, ?, ?)
         ON CONFLICT(transcription_id, language) DO UPDATE SET content = excluded.content`
      ).run(transRow.id, lang, content);
      logger.info({ mediaFileId, language: lang, segments: translatedSegments.length }, 'Translation saved');
      return;
    } catch (err: any) {
      lastError = err;
      logger.warn({ mediaFileId, attempt: attempt + 1, err: err.message }, 'Translation attempt failed');
    }
  }
  throw lastError || new Error('Translation failed');
}
