import type { Project } from './api';

export type StatusTextMode = 'short' | 'long';

const STATUS_TEXT_SHORT: Record<Project['status'], string> = {
  pending: '等待中',
  extracting: '提取音频',
  ready_to_transcribe: '准备转写',
  transcribing: '转写中',
  processing: '处理中',
  completed: '已完成',
  error: '错误'
};

const STATUS_TEXT_LONG: Record<Project['status'], string> = {
  pending: '等待中',
  extracting: '正在提取音频...',
  ready_to_transcribe: '等待开始转写...',
  transcribing: '正在AI转写中...',
  processing: '正在处理中...',
  completed: '已完成',
  error: '错误'
};

export const getProjectStatusText = (status: Project['status'], mode: StatusTextMode = 'short') => {
  const map = mode === 'long' ? STATUS_TEXT_LONG : STATUS_TEXT_SHORT;
  return map[status] || status;
};
