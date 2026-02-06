export interface SubtitleSegment {
  start: number;
  end: number;
  text: string;
}

const pad = (num: number, len: number) => num.toString().padStart(len, '0');

export const formatSrtTimestamp = (seconds: number) => {
  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
};

export const formatVttTimestamp = (seconds: number) => {
  const totalMs = Math.round(seconds * 1000);
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const secs = Math.floor((totalMs % 60_000) / 1000);
  const ms = totalMs % 1000;
  return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)}.${pad(ms, 3)}`;
};

const buildFallbackSegment = (text: string, duration?: number): SubtitleSegment[] => {
  const safeText = text || '';
  const end = Math.max(duration ?? 0, safeText ? safeText.length / 4 : 5);
  return [{ start: 0, end, text: safeText }];
};

export const buildSrt = (segments: SubtitleSegment[], fallbackText: string, duration?: number) => {
  const usableSegments = segments.length ? segments : buildFallbackSegment(fallbackText, duration);
  return usableSegments
    .map((seg, index) => {
      const start = formatSrtTimestamp(Number(seg.start) || 0);
      const end = formatSrtTimestamp(Number(seg.end) || Number(seg.start) + 1);
      const content = (seg.text || '').trim() || '(空)';
      return `${index + 1}\n${start} --> ${end}\n${content}\n`;
    })
    .join('\n');
};

export const buildVtt = (segments: SubtitleSegment[], fallbackText: string, duration?: number) => {
  const usableSegments = segments.length ? segments : buildFallbackSegment(fallbackText, duration);
  const cues = usableSegments
    .map((seg, index) => {
      const start = formatVttTimestamp(Number(seg.start) || 0);
      const end = formatVttTimestamp(Number(seg.end) || Number(seg.start) + 1);
      const content = (seg.text || '').trim() || '(空)';
      return `${index + 1}\n${start} --> ${end}\n${content}\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${cues}`;
};
