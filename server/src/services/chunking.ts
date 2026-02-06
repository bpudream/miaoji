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

/**
 * LLM 返回的纯文本 -> 按 [id] 解析出译文，与原文 segments 按顺序合并为 JSON
 * 解析非常宽容：行首空格、方括号可有可无、Tab/空格/全角空格分隔、1. 或 1) 等
 * 输出与 transcriptions 的 segment 结构对齐：{ start?, end?, text }
 */
export function decompress(
  originalSegments: Segment[],
  translatedLines: string
): Segment[] {
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
