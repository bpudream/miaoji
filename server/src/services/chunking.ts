/**
 * 将转写 JSON 压缩为最小 token 的纯文本供 LLM 翻译，再解压回 JSON。
 * 格式：每行 "[id]\t原文"，便于模型按行返回 "[id]\t译文"。
 */

export interface Segment {
  start?: number;
  end?: number;
  text: string;
}

const SEP = '\t';

/**
 * 宽容行解析：行首空格、[1]/1/1./**1**、Tab/空格/全角空格分隔
 */
const TOLERANT_LINE_RE = /^\s*[\*\[\]]*(\d+)[\*\]\s\t\u3000.]*(.*)$/;

/**
 * JSON segments -> 纯文本，每行 "[index]\ttext"（index 从 1 开始）
 * 段落内换行统一为空格，减少 token
 */
export function compress(segments: Segment[]): string {
  return segments
    .map((s, i) => {
      const id = i + 1;
      const text = (s.text ?? '').replace(/\s+/g, ' ').trim();
      return `[${id}]${SEP}${text}`;
    })
    .join('\n');
}

export interface ChunkOptions {
  chunkTokens: number;
  overlapTokens: number;
  maxContextTokens?: number;
}

export interface ChunkPlan {
  /** 主体段起始索引（0-based，含） */
  start: number;
  /** 主体段结束索引（0-based，含） */
  end: number;
  /** 上下文段起始索引（0-based，含） */
  overlapStart: number;
  /** 上下文段结束索引（0-based，含） */
  overlapEnd: number;
}

/** 简单 token 估算：按字符数粗略折算 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

/** 压缩指定范围段落，ID 使用原始全局索引（从 1 开始） */
export function compressRange(segments: Segment[], start: number, end: number): string {
  const safeStart = Math.max(0, start);
  const safeEnd = Math.min(segments.length - 1, end);
  return segments
    .slice(safeStart, safeEnd + 1)
    .map((s, i) => {
      const id = safeStart + i + 1;
      const text = (s.text ?? '').replace(/\s+/g, ' ').trim();
      return `[${id}]${SEP}${text}`;
    })
    .join('\n');
}

/** 将 LLM 输出解析为 id->text 映射 */
export function parseTranslatedLines(translatedLines: string): Map<number, string> {
  const lines = translatedLines.split('\n');
  const byId = new Map<number, string>();
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const m = trimmed.match(TOLERANT_LINE_RE);
    if (m && m[1]) {
      const id = parseInt(m[1], 10);
      const text = (m[2] ?? '').trim().replace(/\s+/g, ' ');
      if (id >= 1) byId.set(id, text);
    }
  }
  return byId;
}

/** 基于 token 估算的分块与上下文重叠计划 */
export function chunkSegments(segments: Segment[], options: ChunkOptions): ChunkPlan[] {
  if (segments.length === 0) return [];
  const tokens = segments.map((s) => estimateTokens(s.text ?? ''));
  const overlapTokens = Math.max(0, options.overlapTokens);
  let chunkTokens = Math.max(100, options.chunkTokens);
  if (options.maxContextTokens && options.maxContextTokens > overlapTokens) {
    chunkTokens = Math.min(chunkTokens, options.maxContextTokens - overlapTokens);
  }

  const plans: ChunkPlan[] = [];
  let i = 0;
  while (i < segments.length) {
    const start = i;
    let sum = 0;
    while (i < segments.length) {
      const next = sum + (tokens[i] ?? 0);
      if (next > chunkTokens && i > start) break;
      sum = next;
      i += 1;
    }
    const end = i - 1;

    let overlapStart = start;
    let overlapEnd = start - 1;
    if (overlapTokens > 0 && start > 0) {
      let t = 0;
      let j = start - 1;
      while (j >= 0 && t < overlapTokens) {
        t += tokens[j] ?? 0;
        j -= 1;
      }
      overlapStart = Math.max(0, j + 1);
      overlapEnd = start - 1;
    }
    plans.push({ start, end, overlapStart, overlapEnd });
  }
  return plans;
}

/**
 * LLM 返回的纯文本 -> 按 [id] 解析出译文，与原文 segments 按顺序合并为 JSON
 * 解析非常宽容：行首空格、方括号可有可无、Tab/空格/全角空格分隔、1. 或 1) 等
 * 输出与 transcriptions 的 segment 结构对齐：{ start?, end?, text }
 */
export function decompress(
  originalSegments: Segment[],
  translatedLines: string
): Segment[] {
  const byId = parseTranslatedLines(translatedLines);

  return originalSegments.map((seg, i) => {
    const id = i + 1;
    const translated = byId.get(id);
    const out: Segment = {
      text: translated !== undefined && translated !== '' ? translated : seg.text,
    };
    if (seg.start != null) out.start = seg.start;
    if (seg.end != null) out.end = seg.end;
    return out;
  });
}
