import React, { useEffect, useState, useRef, useCallback } from 'react';
import clsx from 'clsx';
import { FileText, Download } from 'lucide-react';
import { getTranscription, TranscriptionResponse, updateTranscription } from '../lib/api';

interface Props {
  fileId: number;
  className?: string;
  onToggleVersionPanel?: () => void;
  onTriggerRefine?: () => void;
  onExport?: () => void;
}

interface Segment {
  start: number;
  end: number;
  text: string;
}

type FilterMode = 'all' | 'edited';
type DensityMode = 'comfortable' | 'compact';

export const TranscriptionResult: React.FC<Props> = ({ fileId, className, onToggleVersionPanel, onTriggerRefine, onExport }) => {
  const [data, setData] = useState<TranscriptionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isEditing, setIsEditing] = useState(false); // New state for edit mode
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [density] = useState<DensityMode>('comfortable');

  // History for undo/redo
  const [history, setHistory] = useState<Segment[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoad = useRef(true);
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const originalSegmentsRef = useRef<Segment[]>([]);
  const editedSegmentIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    let intervalId: any;

    const fetchData = async () => {
      try {
        const result = await getTranscription(fileId);
        setData(result);

        // Stop polling if completed or error
        if (result.status === 'completed' || result.status === 'error') {
          clearInterval(intervalId);
        }
      } catch (err: any) {
        setError(err.message);
        clearInterval(intervalId);
      }
    };

    fetchData();
    intervalId = setInterval(fetchData, 2000);

    return () => {
      clearInterval(intervalId);
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [fileId]);

  // Initialize segments when data loads
  useEffect(() => {
    // 只要数据就绪且还没有初始化过，就尝试初始化
    // 或者如果 segments 为空（可能是解析失败），可以再试一次（虽然一般不会变）
    if (data?.status === 'completed' && data.transcription?.content && isInitialLoad.current) {
      let initialSegments: Segment[] = [];
      const content = data.transcription.content;

      // 1. 如果已经是对象且有 segments
      if (typeof content !== 'string' && Array.isArray(content.segments)) {
        initialSegments = content.segments;
      }
      // 2. 如果是字符串，尝试解析
      else if (typeof content === 'string') {
          try {
              // Try parsing once
              let parsed = JSON.parse(content);

              // Double check: sometimes it's double-stringified (string inside string)
              if (typeof parsed === 'string') {
                  parsed = JSON.parse(parsed);
              }

              if (Array.isArray(parsed.segments)) {
                  initialSegments = parsed.segments;
              } else if (parsed.segments && typeof parsed.segments === 'object') {
                   // 某些极端情况?
              }
          } catch(e) {
              console.warn('[Debug] Failed to parse content string as JSON', e);
          }
      }

      if (initialSegments.length > 0) {
        console.log('[Debug] Loaded segments:', initialSegments.length);
        setSegments(initialSegments);
        originalSegmentsRef.current = JSON.parse(JSON.stringify(initialSegments));
        setHistory([initialSegments]);
        setHistoryIndex(0);
        isInitialLoad.current = false;
      } else {
          console.warn('[Transcription] No segments found in transcription content');
      }
    }
  }, [data]);

  const saveSegments = async (currentSegments: Segment[]) => {
    setIsSaving(true);
    try {
      await updateTranscription(fileId, currentSegments);
      setLastSaved(new Date());
    } catch (e) {
      console.error("Failed to save", e);
      // Optionally show error toast
    } finally {
      setIsSaving(false);
    }
  };

  const debouncedSave = useCallback((newSegments: Segment[]) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      saveSegments(newSegments);
    }, 2000);
  }, [fileId]);

  const handleSegmentChange = (index: number, text: string) => {
    const newSegments = [...segments];
    newSegments[index] = { ...newSegments[index], text };
    setSegments(newSegments);
    editedSegmentIdsRef.current.add(index);
    debouncedSave(newSegments);
  };

  // Record history on blur (when user finishes editing a segment)
  const handleBlur = () => {
    if (history.length === 0) return;

    const currentHistory = history[historyIndex];
    // Simple deep comparison
    if (JSON.stringify(currentHistory) !== JSON.stringify(segments)) {
      const newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(JSON.parse(JSON.stringify(segments)));
      // Limit history size if needed
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

  const enableEditing = (focusIndex?: number) => {
    setIsEditing(true);
    if (typeof focusIndex === 'number') {
      setPendingFocusIndex(focusIndex);
    } else {
      setPendingFocusIndex(null);
    }
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

  const durationLabel = data.duration ? `${(data.duration / 60).toFixed(1)} min` : '未知时长';
  const segmentStat = segments.length > 0 ? `${segments.length} 段` : '未检测到段落';

  const segmentsWithIndex = segments.map((seg, idx) => ({ ...seg, idx }));
  const filteredSegments = segmentsWithIndex.filter(seg => {
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
        <mark key={i} className="bg-yellow-100 text-yellow-900 rounded px-0.5">
          {part}
        </mark>
      ) : (
        <span key={i}>{part}</span>
      )
    );
  };

  const useLongFormat = (data.duration || 0) >= 6000; // 100 分钟以上启用长格式
  const timestampColumnClass =
    useLongFormat ? 'sm:grid-cols-[200px_1fr]' : 'sm:grid-cols-[140px_1fr]';
  const formatTimestamp = (seconds: number) => {
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
  };

  return (
    <div className={clsx("flex h-full flex-col space-y-4 rounded-xl border border-gray-100 bg-white p-5 shadow-sm", className)}>
      {/* Header row 1: Stats + Search + Filter */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
        <div className="flex items-center gap-4">
          <div className="text-sm font-medium text-gray-800">
            {segmentStat} · {durationLabel}
          </div>
          <div className="text-xs text-gray-400">
            最后更新 {lastSaved ? lastSaved.toLocaleTimeString() : new Date(data.created_at || Date.now()).toLocaleTimeString()}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="搜索关键词"
              className="h-9 w-48 rounded-full border border-gray-200 px-3 pl-8 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
            />
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">⌕</span>
          </div>
          <select
            value={filterMode}
            onChange={(e) => setFilterMode(e.target.value as FilterMode)}
            className="h-9 rounded-full border border-gray-200 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
          >
            <option value="all">全部段落</option>
            <option value="edited">仅已编辑</option>
          </select>
        </div>
      </div>

      {/* Header row 2: Action buttons (Edit, Refine, Version, Export) */}
      {data.status === 'completed' && segments.length > 0 && (
        <div className="flex items-center gap-2 -mt-2">
          <button
            onClick={() => enableEditing()}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors"
            title={isEditing ? "编辑中" : "进入编辑"}
          >
            <FileText className="w-4 h-4" />
            编辑
          </button>
          <button
            onClick={onTriggerRefine}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-purple-400 hover:text-purple-600 transition-colors disabled:opacity-40"
            disabled
            title="AI润色（即将推出）"
          >
            <span className="text-base">✨</span>
            润色
          </button>
          <button
            onClick={onToggleVersionPanel}
            className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-40"
            disabled
            title="版本管理（即将推出）"
          >
            <span className="text-base">📋</span>
            版本
          </button>
          {onExport && (
            <button
              onClick={onExport}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors"
              title="导出"
            >
              <Download className="w-4 h-4" />
              导出
            </button>
          )}
        </div>
      )}

      {data.status === 'processing' && (
         <div className="flex items-center space-x-2 text-blue-600">
           <span className="animate-spin">⏳</span>
           <span>Transcribing... (This may take a while depending on GPU)</span>
         </div>
      )}

      {data.status === 'completed' && (
        <div className="flex-1 overflow-hidden">
          <div className="h-full overflow-y-auto pr-1">
          {filteredSegments.length > 0 ? (
            <div className="space-y-0.5 relative">
              {searchTerm && (
                <div className="absolute right-0 top-0 bottom-0 w-2 rounded-full bg-gray-100">
                  {filteredSegments.map((seg) => {
                    const ratio = seg.idx / segments.length;
                    if (!seg.text.toLowerCase().includes(searchTerm.toLowerCase())) return null;
                    return (
                      <span
                        key={`marker-${seg.idx}`}
                        className="absolute left-0 right-0 rounded-full bg-yellow-400/70"
                        style={{ top: `calc(${ratio * 100}% - 4px)`, height: '6px' }}
                      />
                    );
                  })}
                </div>
              )}
               {(() => {
                 const rows: React.ReactNode[] = [];
                 let lastBucket = -1;
                 filteredSegments.forEach((seg) => {
                   const densityStyles =
                     density === 'compact'
                       ? 'px-2 py-1 text-[13px]'
                       : 'px-3 py-1.5 text-sm';
                   const bucket = Math.floor(seg.start / 30);
                   const shouldShowBucket = bucket !== lastBucket;
                   if (shouldShowBucket) {
                     rows.push(
                       <div key={`bucket-${bucket}`} className="sticky top-0 z-10 -mx-3 bg-white/95 px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-gray-300">
                         第 {bucket * 30}s - {(bucket + 1) * 30}s
                       </div>
                     );
                     lastBucket = bucket;
                   }

                   rows.push(
                     <div
                       key={seg.idx}
                       className={`grid grid-cols-1 ${timestampColumnClass} gap-3 rounded-lg ${densityStyles} transition-colors ${
                         isEditing ? 'bg-blue-50/30' : 'odd:bg-gray-50/50'
                       }`}
                     >
                       <div className="text-[11px] font-mono tracking-[0.06em] text-gray-400 select-none leading-6 flex items-center gap-1">
                         <span className="h-4 w-px bg-gray-200 hidden sm:inline-block" />
                         <span>
                           {formatTimestamp(seg.start)} → {formatTimestamp(seg.end)}
                         </span>
                       </div>
                       {isEditing ? (
                         <textarea
                           className="w-full min-h-[2.8rem] rounded-lg border border-gray-200 bg-white/90 px-3 py-2 text-sm leading-6 shadow-inner focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                           value={seg.text}
                           onChange={(e) => handleSegmentChange(seg.idx, e.target.value)}
                           onBlur={handleBlur}
                           rows={Math.max(2, Math.ceil(seg.text.length / 60))}
                           ref={(el) => (textareaRefs.current[seg.idx] = el)}
                         />
                       ) : (
                         <div
                           className="rounded-lg px-3 py-1.5 leading-6 text-gray-800 cursor-text"
                           onDoubleClick={() => enableEditing(seg.idx)}
                         >
                           {getHighlightedText(seg.text)}
                         </div>
                       )}
                     </div>
                   );
                 });
                 return rows;
               })()}
            </div>
          ) : (
            <div className="bg-gray-50 p-4 rounded whitespace-pre-wrap max-h-96 overflow-y-auto text-sm text-gray-600">
               没有符合筛选条件的段落，以下展示原始文本：
               <div className="mt-2 font-mono text-xs text-gray-500">
                 {data.transcription && (typeof data.transcription.content === 'string'
                    ? data.transcription.content
                    : JSON.stringify(data.transcription.content, null, 2))}
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
            className={`h-9 w-9 inline-flex items-center justify-center rounded-full border text-sm ${historyIndex <= 0 ? 'bg-gray-100 text-gray-400' : 'bg-white hover:bg-gray-50 text-gray-600'}`}
            title="撤销 (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            onClick={handleRedo}
            disabled={historyIndex >= history.length - 1}
            className={`h-9 w-9 inline-flex items-center justify-center rounded-full border text-sm ${historyIndex >= history.length - 1 ? 'bg-gray-100 text-gray-400' : 'bg-white hover:bg-gray-50 text-gray-600'}`}
            title="重做 (Ctrl+Shift+Z)"
          >
            ↷
          </button>
          <span className="text-xs text-gray-500">
            {isSaving ? '自动保存中…' : '更改将自动保存'}
          </span>
          <button
            onClick={() => setIsEditing(false)}
            className="h-9 rounded-full bg-blue-600 px-4 text-sm font-medium text-white shadow hover:bg-blue-700"
          >
            完成
          </button>
        </div>
      )}
    </div>
  );
};
