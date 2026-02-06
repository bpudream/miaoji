import type { Segment } from './types';

export function extractSegmentsFromContent(content: any): Segment[] {
  if (!content) return [];
  if (typeof content !== 'string' && Array.isArray(content.segments)) {
    return content.segments as Segment[];
  }
  if (typeof content === 'string') {
    try {
      let parsed: any = JSON.parse(content);
      if (typeof parsed === 'string') parsed = JSON.parse(parsed);
      if (Array.isArray(parsed?.segments)) return parsed.segments as Segment[];
    } catch {
      return [];
    }
  }
  return [];
}

export function formatTime(seconds: number): string {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function parseRosterNames(roster: string | null | undefined): string[] {
  if (!roster || !roster.trim()) return [];
  return roster
    .split(/[\r\n,，]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 根据总时长是否 >= 100 分钟决定是否使用长格式时间戳 */
export function useLongTimestamp(durationSeconds: number): boolean {
  return (durationSeconds || 0) >= 6000;
}

export function formatTimestamp(seconds: number, useLongFormat: boolean): string {
  if (!useLongFormat) {
    const mins = Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0');
    const secs = (seconds % 60).toFixed(1).padStart(4, '0');
    return `${mins}:${secs}`;
  }
  const minutes = Math.floor(seconds / 60);
  const sec = seconds - minutes * 60;
  const minuteStr = minutes.toString().padStart(3, '0');
  const secondStr = sec.toFixed(1).padStart(5, '0');
  return `${minuteStr} MIN ${secondStr} S`;
}
