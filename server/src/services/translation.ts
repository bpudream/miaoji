import db from '../db';
import { getLLMConfig } from './config';
import { LLMFactory } from '../ai/factory';
import {
  chunkSegments,
  compressRange,
  parseTranslatedLines,
  type Segment,
} from './chunking';
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
 * 翻译流程：Load JSON -> Chunk -> LLM -> Merge -> Save JSON
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

  const isOllama = config?.provider === 'ollama';
  const defaultChunkTokens = isOllama ? 1200 : 3000;
  const defaultOverlapTokens = isOllama ? 200 : 400;
  const defaultContextTokens = isOllama ? 4096 : 8192;
  const chunkTokens = config?.translation_chunk_tokens ?? defaultChunkTokens;
  const overlapTokens = config?.translation_overlap_tokens ?? defaultOverlapTokens;
  const contextTokens = config?.translation_context_tokens ?? defaultContextTokens;

  const plans = chunkSegments(segments, {
    chunkTokens,
    overlapTokens,
    maxContextTokens: contextTokens,
  });
  if (plans.length === 0) {
    throw new Error('No segments to translate');
  }

  const totalChunks = plans.length;
  const initContent = JSON.stringify({ segments: [] as Segment[] });
  db.prepare(
    `INSERT INTO translations (transcription_id, language, content, status, progress, total_chunks, completed_chunks, started_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(transcription_id, language) DO UPDATE SET
       status = excluded.status,
       progress = excluded.progress,
       total_chunks = excluded.total_chunks,
       completed_chunks = excluded.completed_chunks,
       started_at = excluded.started_at,
       updated_at = datetime('now'),
       content = excluded.content`
  ).run(transRow.id, lang, initContent, 'processing', 0, totalChunks, 0);

  const systemPrompt = `You are a professional subtitle translator.
Translate the following text lines into ${lang}.
Strictly follow this format for each line:
[ID] <Translated Text>

Rules:
1. Keep the [ID] exactly as in the input.
2. Do not merge or split lines.
3. Only output the translated lines, no explanations.
4. If a line is just a symbol or meaningless, keep it as is.`;

  const translatedTexts = segments.map((s) => s.text ?? '');
  let completedChunks = 0;

  let lastProgress = 0;
  let lastCompleted = 0;
  const updateProgress = (progress: number, status: string, completed: number) => {
    lastProgress = progress;
    lastCompleted = completed;
    db.prepare(
      `UPDATE translations SET status = ?, progress = ?, completed_chunks = ?, updated_at = datetime('now')
       WHERE transcription_id = ? AND language = ?`
    ).run(status, progress, completed, transRow.id, lang);
  };

  try {
    for (const plan of plans) {
      const overlapStart = plan.overlapStart;
      const overlapEnd = plan.overlapEnd;
      let contextBlock = '';
      if (overlapEnd >= overlapStart) {
        const lines: string[] = [];
        for (let i = overlapStart; i <= overlapEnd; i += 1) {
          const id = i + 1;
          const original = (segments[i]?.text ?? '').replace(/\s+/g, ' ').trim();
          const translated = (translatedTexts[i] ?? '').replace(/\s+/g, ' ').trim();
          if (original) {
            lines.push(`[${id}] ${original} -> ${translated || original}`);
          }
        }
        if (lines.length > 0) {
          contextBlock = `Context (previous translated):\n${lines.join('\n')}\n\n`;
        }
      }

      const input = compressRange(segments, plan.start, plan.end);
      if (isOllama && input.length > COMPRESSED_LENGTH_GUARD) {
        throw new Error(
          '视频内容过长，当前使用的本地模型上下文有限，可能无法完整翻译。请到「设置 - AI 模型」中切换到支持长上下文的在线模型（如 DeepSeek）后再试。'
        );
      }

      const userPrompt = `${contextBlock}Input:\n${input}`;
      const messages = [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: userPrompt },
      ];

      let lastError: Error | null = null;
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const raw = await provider.chat(messages);
          const byId = parseTranslatedLines(raw);
          for (let i = plan.start; i <= plan.end; i += 1) {
            const id = i + 1;
            const translated = byId.get(id);
            if (translated && translated.trim()) {
              translatedTexts[i] = translated;
            }
          }
          lastError = null;
          break;
        } catch (err: any) {
          lastError = err;
          logger.warn(
            { mediaFileId, attempt: attempt + 1, err: err.message, chunk: `${plan.start}-${plan.end}` },
            'Translation attempt failed'
          );
        }
      }
      if (lastError) {
        updateProgress(
          Math.max(0, Math.min(100, (completedChunks / totalChunks) * 100)),
          'error',
          completedChunks
        );
        throw lastError;
      }

      completedChunks += 1;
      const progress = Math.min(100, Math.round((completedChunks / totalChunks) * 100));
      updateProgress(progress, 'processing', completedChunks);
    }

    const translatedSegments = segments.map((seg, i) => ({
      text: translatedTexts[i] ?? seg.text,
      ...(seg.start != null ? { start: seg.start } : {}),
      ...(seg.end != null ? { end: seg.end } : {}),
    }));
    const content = JSON.stringify({ segments: translatedSegments });
    db.prepare(
      `INSERT INTO translations (transcription_id, language, content, status, progress, total_chunks, completed_chunks, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(transcription_id, language) DO UPDATE SET
         content = excluded.content,
         status = excluded.status,
         progress = excluded.progress,
         total_chunks = excluded.total_chunks,
         completed_chunks = excluded.completed_chunks,
         updated_at = datetime('now')`
    ).run(transRow.id, lang, content, 'completed', 100, totalChunks, totalChunks);
    logger.info({ mediaFileId, language: lang, segments: translatedSegments.length }, 'Translation saved');
  } catch (err: any) {
    updateProgress(lastProgress, 'error', lastCompleted);
    throw err;
  }
}
