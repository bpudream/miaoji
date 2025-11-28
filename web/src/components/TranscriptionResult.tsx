import React, { useEffect, useState, useRef, useCallback } from 'react';
import clsx from 'clsx';
import { getTranscription, TranscriptionResponse, updateTranscription, exportTranscription, ExportFormat, Project } from '../lib/api';
import { FileText, Copy, Loader2, Download, AlertCircle, Anchor } from 'lucide-react';

interface Props {
  fileId: string;
  className?: string;
  isEditing?: boolean; // 外部控制的编辑状态
  onEditingChange?: (editing: boolean) => void; // 编辑状态变化回调
  onSegmentClick?: (time: number) => void; // 段落点击回调，传递时间戳
  currentPlayTime?: number; // 当前播放时间，用于高亮当前段落
  onStatsChange?: (stats: { segmentCount: number; duration: number | null; lastSaved: Date | null }) => void; // 统计数据变化回调
}

interface Segment {
  start: number;
  end: number;
  text: string;
}

type FilterMode = 'all' | 'edited';

export const TranscriptionResult: React.FC<Props> = ({
  fileId,
  className,
  isEditing: externalIsEditing,
  onEditingChange,
  onSegmentClick,
  currentPlayTime = 0,
  onStatsChange
}) => {
  const [data, setData] = useState<TranscriptionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [isEditing, setIsEditing] = useState(externalIsEditing ?? false); // 使用外部状态或内部状态
  const [pendingFocusIndex, setPendingFocusIndex] = useState<number | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<FilterMode>('all');
  const [autoScroll, setAutoScroll] = useState(true);

  // History for undo/redo
  const [history, setHistory] = useState<Segment[][]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitialLoad = useRef(true);
  const textareaRefs = useRef<(HTMLTextAreaElement | null)[]>([]);
  const segmentRefs = useRef<(HTMLDivElement | null)[]>([]);
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

  // 通知父组件统计数据变化
  useEffect(() => {
    if (data && onStatsChange) {
      onStatsChange({
        segmentCount: segments.length,
        duration: data.duration || null,
        lastSaved
      });
    }
  }, [segments.length, data?.duration, lastSaved, onStatsChange]);

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

  // 同步外部编辑状态
  useEffect(() => {
    if (externalIsEditing !== undefined) {
      setIsEditing(externalIsEditing);
    }
  }, [externalIsEditing]);

  // 自动滚动到当前播放段落
  useEffect(() => {
    if (currentPlayTime > 0 && autoScroll) {
      const currentIndex = segments.findIndex(
        seg => currentPlayTime >= seg.start && currentPlayTime < seg.end
      );
      if (currentIndex >= 0 && segmentRefs.current[currentIndex]) {
        segmentRefs.current[currentIndex]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }
    }
  }, [currentPlayTime, segments, autoScroll]);

  const enableEditing = (focusIndex?: number) => {
    const newEditingState = true;
    setIsEditing(newEditingState);
    onEditingChange?.(newEditingState);
    if (typeof focusIndex === 'number') {
      setPendingFocusIndex(focusIndex);
    } else {
      setPendingFocusIndex(null);
    }
  };

  const disableEditing = () => {
    const newEditingState = false;
    setIsEditing(newEditingState);
    onEditingChange?.(newEditingState);
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
    <div className={clsx("flex h-full flex-col p-5 pt-0", className)}>
      {/* Toolbar: Search + Filter */}
      <div className="flex-shrink-0 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 pb-3">
        <div className="relative flex-1">
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="搜索关键词"
            className="w-full h-9 rounded-full border border-gray-200 px-3 pl-8 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-200"
          />
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 text-xs">⌕</span>
        </div>
        <div className="flex gap-2">
           <button
             onClick={() => setAutoScroll(!autoScroll)}
             className={clsx(
               "h-9 px-3 rounded-full border text-sm flex items-center gap-1 transition-colors whitespace-nowrap",
               autoScroll
                 ? "bg-blue-50 text-blue-600 border-blue-200"
                 : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50"
             )}
             title={autoScroll ? "已开启自动跟随" : "点击开启自动跟随"}
           >
             <Anchor className={clsx("w-3.5 h-3.5", autoScroll && "fill-current")} />
             <span className="hidden sm:inline">{autoScroll ? "跟随中" : "不跟随"}</span>
             <span className="sm:hidden">{autoScroll ? "跟随" : "静止"}</span>
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


      {data.status === 'processing' && (
         <div className="flex items-center space-x-2 text-blue-600">
           <span className="animate-spin">⏳</span>
           <span>Transcribing... (This may take a while depending on GPU)</span>
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
               {filteredSegments.map((seg) => {
                 // 判断是否为当前播放段落
                 const isCurrentSegment = currentPlayTime >= seg.start && currentPlayTime < seg.end;

                 return (
                   <div
                     key={seg.idx}
                     ref={(el) => (segmentRefs.current[seg.idx] = el)}
                     className={clsx(
                       `grid grid-cols-1 ${timestampColumnClass} gap-2 px-3 py-1 rounded-lg transition-all break-words`,
                       isCurrentSegment && !isEditing && 'bg-indigo-50 border-2 border-indigo-200 shadow-sm',
                       !isCurrentSegment && isEditing && 'bg-blue-50/30',
                       !isCurrentSegment && !isEditing && 'odd:bg-gray-50/50'
                     )}
                   >
                     <div
                       className="text-[11px] font-mono tracking-[0.06em] text-gray-400 select-none leading-6 flex items-center gap-1 cursor-pointer hover:text-indigo-600 transition-colors"
                       onClick={() => onSegmentClick?.(seg.start)}
                       title="点击跳转到此时间"
                     >
                       <span className="h-4 w-px bg-gray-200 hidden sm:inline-block" />
                       <span>
                         {formatTimestamp(seg.start)} → {formatTimestamp(seg.end)}
                       </span>
                     </div>
                     {isEditing ? (
                       <textarea
                         className="w-full min-h-[2.8rem] rounded-lg border border-gray-200 bg-white/90 px-3 py-2 text-base leading-relaxed shadow-inner focus:border-blue-500 focus:ring-2 focus:ring-blue-200 break-words whitespace-pre-wrap"
                         value={seg.text}
                         onChange={(e) => handleSegmentChange(seg.idx, e.target.value)}
                         onBlur={handleBlur}
                         rows={Math.max(2, Math.ceil(seg.text.length / 60))}
                         ref={(el) => (textareaRefs.current[seg.idx] = el)}
                       />
                     ) : (
                       <div
                         className={clsx(
                           "rounded-lg px-3 py-0.5 leading-relaxed text-lg text-gray-800 cursor-pointer transition-colors break-words whitespace-pre-wrap",
                           isCurrentSegment ? "bg-indigo-50/50" : "hover:bg-gray-100"
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

interface TranscriptionPanelProps {
  project: Project;
  className?: string;
  playerRef: React.RefObject<{ seekTo: (time: number) => void }>;
  currentPlayTime: number;
}

export const TranscriptionPanel: React.FC<TranscriptionPanelProps> = ({
  project,
  className,
  playerRef,
  currentPlayTime
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [stats, setStats] = useState<{ segmentCount: number; duration: number | null; lastSaved: Date | null } | null>(null);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!exportMenuRef.current) return;
      if (!exportMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const handleExport = async (format: ExportFormat) => {
    if (!project) return;
    setExportingFormat(format);
    try {
      const { blob, filename } = await exportTranscription(project.id, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const fallbackName = `${project.original_name || project.filename || 'transcription'}.${format}`;
      link.download = filename || fallbackName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('导出失败，请稍后再试');
    } finally {
      setExportingFormat(null);
      setExportMenuOpen(false);
    }
  };

  const handleEditToggle = () => {
    setIsEditing(!isEditing);
  };

  const handleTriggerRefine = () => {
    alert('润色流程开发中，待 US-6.4 集成后可调用 Ollama 润色稿件');
  };

  const handleVersionPanel = () => {
    alert('版本管理面板开发中，待 US-6.5 完成后可切换历史版本');
  };

  const durationLabel = stats?.duration ? `${(stats.duration / 60).toFixed(1)} min` : '未知时长';
  const segmentStat = stats?.segmentCount ? `${stats.segmentCount} 段` : '';

  return (
    <div className={clsx("flex h-full flex-col rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden", className)}>
      {/* Header Section */}
      <div className="flex-shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-gray-800">
            <FileText className="w-5 h-5 text-blue-500" />
            转写内容
          </h2>
          {stats && (
            <>
              <span className="text-xs text-gray-500 font-medium bg-gray-50 px-2.5 py-1 rounded-full border border-gray-200">
                {segmentStat} · {durationLabel}
              </span>
              {stats.lastSaved && (
                <span className="text-xs text-gray-400">
                  最后更新 {stats.lastSaved.toLocaleTimeString()}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {project.transcription && (
            <button
              className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded hover:bg-blue-50"
              onClick={() => {
                const content = project.transcription?.content;
                const text = typeof content === 'object' ? (content.text || JSON.stringify(content)) : content;
                navigator.clipboard.writeText(text || '');
              }}
              title="复制全文"
            >
              <Copy className="w-4 h-4" />
            </button>
          )}
          {project.status === 'completed' && (
            <>
              <button
                onClick={handleEditToggle}
                className={clsx(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
                  isEditing
                    ? "border-blue-400 bg-blue-50 text-blue-600"
                    : "border-gray-300 text-gray-700 hover:border-blue-400 hover:text-blue-600"
                )}
                title={isEditing ? "编辑中" : "进入编辑"}
              >
                <FileText className="w-4 h-4" />
                编辑
              </button>
              <button
                onClick={handleTriggerRefine}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-purple-400 hover:text-purple-600 transition-colors disabled:opacity-40"
                disabled
                title="AI润色（即将推出）"
              >
                <span className="text-base">✨</span>
                润色
              </button>
              <button
                onClick={handleVersionPanel}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors disabled:opacity-40"
                disabled
                title="版本管理（即将推出）"
              >
                <span className="text-base">📋</span>
                版本
              </button>
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setExportMenuOpen(!exportMenuOpen)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-blue-400 hover:text-blue-600 transition-colors"
                  title="导出"
                >
                  <Download className="w-4 h-4" />
                  导出
                </button>
                {exportMenuOpen && (
                  <div className="absolute right-0 mt-2 w-40 rounded-xl border border-gray-100 bg-white p-1 text-sm shadow-lg z-20">
                    {[
                      { format: 'txt', label: 'TXT 文本' },
                      { format: 'json', label: 'JSON 数据' },
                      { format: 'srt', label: 'SRT 字幕' },
                    ].map((option) => (
                      <button
                        key={option.format}
                        onClick={() => handleExport(option.format as ExportFormat)}
                        disabled={exportingFormat === option.format}
                        className={clsx(
                          'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-gray-50',
                          exportingFormat === option.format ? 'text-gray-400' : 'text-gray-700'
                        )}
                      >
                        <span>{option.label}</span>
                        {exportingFormat === option.format && (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content Section */}
      <div className="flex-1 overflow-hidden px-6">
        {project.status === 'completed' ? (
          <TranscriptionResult
            fileId={project.id}
            className="h-full"
            isEditing={isEditing}
            onEditingChange={setIsEditing}
            onSegmentClick={(time) => playerRef.current?.seekTo(time)}
            currentPlayTime={currentPlayTime}
            onStatsChange={setStats}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-gray-400">
            {project.status === 'error' ? (
              <>
                <AlertCircle className="w-12 h-12 text-red-200 mb-2" />
                <p>转写失败</p>
              </>
            ) : (
              <>
                <Loader2 className="w-12 h-12 animate-spin text-blue-100 mb-2" />
                <p>
                  {project.status === 'extracting' ? '正在提取音频...' :
                   project.status === 'transcribing' ? '正在AI转写中...' :
                   '正在处理中，请稍候...'}
                </p>
                <p className="text-xs text-gray-300 mt-2">大文件可能需要较长时间</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
