import React, { useEffect, useState, useRef, useCallback } from 'react';
import clsx from 'clsx';
import {
  getTranscription,
  type TranscriptionResponse,
  updateTranscription,
} from '../../lib/api';
import { Anchor } from 'lucide-react';
import { extractSegmentsFromContent, formatTimestamp, useLongTimestamp } from './utils';
import type { Segment } from './types';
import type { TranscriptionResultProps } from './types';
import type { FilterMode } from './types';

export const TranscriptionResult: React.FC<TranscriptionResultProps> = ({
  fileId,
  projectStatus,
  className,
  isEditing: externalIsEditing,
  onEditingChange,
  onSegmentClick,
  currentPlayTime = 0,
  onStatsChange,
}) => {
  const [data, setData] = useState<TranscriptionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isEditing, setIsEditing] = useState(externalIsEditing ?? false);
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [autoScroll, setAutoScroll] = useState(true);

  const [history, setHistory] = useState<Segment[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoad = useRef(true);
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
  const editedSegmentIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    let intervalId: number | undefined;
    const fetchData = async () => {
      try {
        const result = await getTranscription(fileId);
        setData(result);
        if (result.status === 'completed' || result.status === 'error') {
          if (intervalId) window.clearInterval(intervalId);
          intervalId = undefined;
        }
      } catch (err: any) {
        setError(err.message);
        if (intervalId) window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    const shouldPoll =
      !projectStatus ||
      (projectStatus !== 'completed' && projectStatus !== 'error');
    fetchData();
    if (shouldPoll) {
      intervalId = window.setInterval(fetchData, 2000);
    }
    return () => {
      if (intervalId) window.clearInterval(intervalId);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [fileId, projectStatus]);

  useEffect(() => {
    if (!projectStatus) return;
    if (projectStatus !== 'completed') {
      isInitialLoad.current = true;
      setSegments([]);
      setHistory([]);
      setHistoryIndex(-1);
      editedSegmentIdsRef.current = new Set();
      setLastSaved(null);
    }
  }, [fileId, projectStatus]);

  useEffect(() => {
    if (
      data?.status === 'completed' &&
      data.transcription?.content &&
      isInitialLoad.current
    ) {
      const initialSegments = extractSegmentsFromContent(data.transcription.content);
      if (initialSegments.length > 0) {
        setSegments(initialSegments);
        setHistory([initialSegments]);
        setHistoryIndex(0);
        isInitialLoad.current = false;
      }
    }
  }, [data]);

  useEffect(() => {
    if (data && onStatsChange) {
      onStatsChange({
        segmentCount: segments.length,
        duration: data.duration || null,
        lastSaved,
      });
    }
  }, [segments.length, data?.duration, lastSaved, onStatsChange]);

  const saveSegments = async (currentSegments: Segment[]) => {
    setIsSaving(true);
    try {
      await updateTranscription(fileId, currentSegments);
      setLastSaved(new Date());
    } catch (e) {
      console.error('Failed to save', e);
    } finally {
      setIsSaving(false);
    }
  };

  const debouncedSave = useCallback(
    (newSegments: Segment[]) => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        saveSegments(newSegments);
      }, 2000);
    },
    [fileId]
  );

  const handleSegmentChange = (index: number, text: string) => {
    const newSegments = [...segments];
    newSegments[index] = { ...newSegments[index], text };
    setSegments(newSegments);
    editedSegmentIdsRef.current.add(index);
    debouncedSave(newSegments);
  };

  const handleBlur = () => {
    if (history.length === 0) return;
    const currentHistory = history[historyIndex];
    if (JSON.stringify(currentHistory) !== JSON.stringify(segments)) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(JSON.parse(JSON.stringify(segments)));
      if (newHistory.length > 50) newHistory.shift();
      setHistory(newHistory);
      setHistoryIndex(newHistory.length - 1);
    }
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      const prevSegments = history[newIndex];
      setSegments(JSON.parse(JSON.stringify(prevSegments)));
      setHistoryIndex(newIndex);
      debouncedSave(prevSegments);
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      const nextSegments = history[newIndex];
      setSegments(JSON.parse(JSON.stringify(nextSegments)));
      setHistoryIndex(newIndex);
      debouncedSave(nextSegments);
    }
  };

  useEffect(() => {
    if (externalIsEditing !== undefined) {
      setIsEditing(externalIsEditing);
    }
  }, [externalIsEditing]);

  useEffect(() => {
    if (currentPlayTime > 0 && autoScroll) {
      const currentIndex = segments.findIndex(
        (seg) => currentPlayTime >= seg.start && currentPlayTime < seg.end
      );
      if (currentIndex >= 0 && segmentRefs.current[currentIndex]) {
        segmentRefs.current[currentIndex]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [currentPlayTime, segments, autoScroll]);

  const enableEditing = (focusIndex?: number) => {
    setIsEditing(true);
    onEditingChange?.(true);
    setPendingFocusIndex(typeof focusIndex === 'number' ? focusIndex : null);
  };

  const disableEditing = () => {
    setIsEditing(false);
    onEditingChange?.(false);
  };

  useEffect(() => {
    if (isEditing && pendingFocusIndex !== null) {
      const textarea = textareaRefs.current[pendingFocusIndex];
      if (textarea) {
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
      setPendingFocusIndex(null);
    }
  }, [isEditing, pendingFocusIndex]);

  if (error) {
    return <div className="text-red-500 p-4">Error: {error}</div>;
  }
  if (!data) {
    return <div className="p-4">Loading...</div>;
  }

  const segmentsWithIndex = segments.map((seg, idx) => ({ ...seg, idx }));
  const filteredSegments = segmentsWithIndex.filter((seg) => {
    if (filterMode === 'edited' && !editedSegmentIdsRef.current.has(seg.idx)) {
      return false;
    }
    if (searchTerm.trim()) {
      return seg.text.toLowerCase().includes(searchTerm.toLowerCase());
    }
    return true;
  });

  const getHighlightedText = (text: string) => {
    if (!searchTerm.trim()) return text;
    const regex = new RegExp(`(${searchTerm})`, 'gi');
    const parts = text.split(regex);
    return parts.map((part, i) =>
      i % 2 === 1 ? (
        <mark
          key={i}
          className="bg-yellow-100 text-yellow-900 rounded px-0.5"
        >
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  const useLongFormat = useLongTimestamp(data.duration || 0);
  const timestampColumnClass = useLongFormat
    ? 'sm:grid-cols-[200px_1fr]'
    : 'sm:grid-cols-[140px_1fr]';

  return (
    <div className={clsx('flex h-full flex-col p-5 pt-0', className)}>
      <div className="flex-shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pb-3">
        <div className="relative flex-1">
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索关键词"
            className="w-full h-9 rounded-full border border-gray-200 px-3 pl-8 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">
            ⌕
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setAutoScroll(!autoScroll)}
            className={clsx(
              'h-9 px-3 rounded-full border text-sm flex items-center gap-1 transition-colors whitespace-nowrap',
              autoScroll
                ? 'bg-blue-50 text-blue-600 border-blue-200'
                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            )}
            title={autoScroll ? '已开启自动跟随' : '点击开启自动跟随'}
          >
            <Anchor
              className={clsx('w-3.5 h-3.5', autoScroll && 'fill-current')}
            />
            <span className="hidden sm:inline">
              {autoScroll ? '跟随中' : '不跟随'}
            </span>
            <span className="sm:hidden">{autoScroll ? '跟随' : '静止'}</span>
          </button>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as FilterMode)}
            className="h-9 rounded-full border border-gray-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200 flex-1 sm:flex-none sm:w-auto"
          >
            <option value="all">全部</option>
            <option value="edited">已编辑</option>
          </select>
        </div>
      </div>

      {(data.status === 'transcribing' || data.status === 'processing') && (
        <div className="flex items-center space-x-2 text-blue-600">
          <span className="animate-spin">⏳</span>
          <span>转写中...</span>
        </div>
      )}

      {data.status === 'completed' && (
        <div className="flex-1 overflow-hidden overflow-x-hidden">
          <div className="h-full overflow-y-auto overflow-x-hidden pr-1">
            {filteredSegments.length > 0 ? (
              <div className="space-y-0.5 relative">
                {searchTerm && (
                  <div className="absolute right-0 top-0 bottom-0 w-2 rounded-full bg-gray-100">
                    {filteredSegments.map((seg) => {
                      const ratio = seg.idx / segments.length;
                      if (
                        !seg.text
                          .toLowerCase()
                          .includes(searchTerm.toLowerCase())
                      )
                        return null;
                      return (
                        <span
                          key={`marker-${seg.idx}`}
                          className="absolute left-0 right-0 rounded-full bg-yellow-400/70"
                          style={{
                            top: `calc(${ratio * 100}% - 4px)`,
                            height: '6px',
                          }}
                        />
                      );
                    })}
                  </div>
                )}
                {filteredSegments.map((seg) => {
                  const isCurrentSegment =
                    currentPlayTime >= seg.start && currentPlayTime < seg.end;
                  return (
                    <div
                      key={seg.idx}
                      ref={(el) => (segmentRefs.current[seg.idx] = el)}
                      className={clsx(
                        `grid grid-cols-1 ${timestampColumnClass} gap-2 px-3 py-1 rounded-lg transition-all break-words`,
                        isCurrentSegment &&
                          !isEditing &&
                          'bg-indigo-50 border-2 border-indigo-200 shadow-sm',
                        !isCurrentSegment && isEditing && 'bg-blue-50/30',
                        !isCurrentSegment &&
                          !isEditing &&
                          'odd:bg-gray-50/50'
                      )}
                    >
                      <div
                        className="text-[11px] font-mono tracking-[0.06em] text-gray-400 select-none leading-6 flex items-center gap-1 cursor-pointer hover:text-indigo-600 transition-colors"
                        onClick={() => onSegmentClick?.(seg.start)}
                        title="点击跳转到此时间"
                      >
                        <span className="h-4 w-px bg-gray-200 hidden sm:inline-block" />
                        <span>
                          {formatTimestamp(seg.start, useLongFormat)} →{' '}
                          {formatTimestamp(seg.end, useLongFormat)}
                        </span>
                      </div>
                      {isEditing ? (
                        <textarea
                          className="w-full min-h-[2.8rem] rounded-lg border border-gray-200 bg-white/90 px-3 py-2 text-base leading-relaxed shadow-inner focus:border-blue-500 focus:ring-2 focus:ring-blue-200 break-words whitespace-pre-wrap"
                          value={seg.text}
                          onChange={(e) =>
                            handleSegmentChange(seg.idx, e.target.value)
                          }
                          onBlur={handleBlur}
                          rows={Math.max(2, Math.ceil(seg.text.length / 60))}
                          ref={(el) =>
                            (textareaRefs.current[seg.idx] = el)
                          }
                        />
                      ) : (
                        <div
                          className={clsx(
                            'rounded-lg px-3 py-0.5 leading-relaxed text-lg text-gray-800 cursor-pointer transition-colors break-words whitespace-pre-wrap',
                            isCurrentSegment
                              ? 'bg-indigo-50/50'
                              : 'hover:bg-gray-100'
                          )}
                          onDoubleClick={() => enableEditing(seg.idx)}
                          onClick={() => onSegmentClick?.(seg.start)}
                          title="双击编辑，单击跳转"
                        >
                          {getHighlightedText(seg.text)}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-gray-50 p-4 rounded whitespace-pre-wrap max-h-96 overflow-y-auto text-lg text-gray-600 break-words">
                没有符合筛选条件的段落，以下展示原始文本：
                <div className="mt-2 font-mono text-xs text-gray-500">
                  {data.transcription &&
                    (typeof data.transcription.content === 'string'
                      ? data.transcription.content
                      : JSON.stringify(
                          data.transcription.content,
                          null,
                          2
                        ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {isEditing && (
        <div className="fixed bottom-6 right-6 flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 shadow-xl border border-gray-100">
          <button
            onClick={handleUndo}
            disabled={historyIndex <= 0}
            className={clsx(
              'h-9 w-9 inline-flex items-center justify-center rounded-full border text-sm',
              historyIndex <= 0
                ? 'bg-gray-100 text-gray-400'
                : 'bg-white hover:bg-gray-50 text-gray-600'
            )}
            title="撤销 (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            className={clsx(
              'h-9 w-9 inline-flex items-center justify-center rounded-full border text-sm',
              historyIndex >= history.length - 1
                ? 'bg-gray-100 text-gray-400'
                : 'bg-white hover:bg-gray-50 text-gray-600'
            )}
            title="重做 (Ctrl+Shift+Z)"
          >
            ↷
          </button>
          <span className="text-xs text-gray-500">
            {isSaving ? '自动保存中…' : '更改将自动保存'}
          </span>
          <button
            onClick={disableEditing}
            className="h-9 rounded-full bg-blue-600 px-4 text-sm font-medium text-white shadow hover:bg-blue-700"
          >
            完成
          </button>
        </div>
      )}
    </div>
  );
};
