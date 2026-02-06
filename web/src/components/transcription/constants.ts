export const TRANSCRIBE_SCENARIO_OPTIONS = [
  { value: 'default', label: '通用模式 (Default)' },
  { value: 'education', label: '教育/讲座 (Education)' },
  { value: 'sports_football', label: '体育/足球解说 (Sports/Football)' },
];

export const EXPORT_FORMAT_OPTIONS = [
  { format: 'txt', label: 'TXT 文本' },
  { format: 'json', label: 'JSON 数据' },
  { format: 'srt', label: 'SRT 字幕' },
  { format: 'vtt', label: 'VTT 字幕' },
  { format: 'srt_translated', label: '译文 SRT' },
  { format: 'srt_bilingual', label: '双语 SRT' },
] as const;
