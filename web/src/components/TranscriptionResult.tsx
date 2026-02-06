import React, { useEffect, useState, useRef, useCallback } from 'react';
import clsx from 'clsx';
import { getTranscription, TranscriptionResponse, updateTranscription, exportTranscription, ExportFormat, Project, getTranslation, requestTranslation, TranslationResponse, startTranscription, getTeams, getTranscribePreview, type Team, type RosterMode } from '../lib/api';
import { getProjectStatusText } from '../lib/status';
import { FileText, Copy, Loader2, Download, AlertCircle, Anchor, MoreVertical } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';

interface Props {
  fileId: string;
  projectStatus?: Project['status'];
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

const extractSegmentsFromContent = (content: any): Segment[] => {
  if (!content) return [];
  // 1. 已是对象且有 segments
  if (typeof content !== 'string' && Array.isArray(content.segments)) {
    return content.segments as Segment[];
  }
  // 2. string -> JSON
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
};

const formatTime = (seconds: number) => {
  if (isNaN(seconds)) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const parseRosterNames = (roster: string | null | undefined): string[] => {
  if (!roster || !roster.trim()) return [];
  return roster
    .split(/[\r\n,，]+/)
    .map((s) => s.trim())
    .filter(Boolean);
};

type FilterMode = 'all' | 'edited';
type ViewMode = 'original' | 'translated' | 'bilingual';

export const TranscriptionResult: React.FC<Props> = ({
  fileId,
  projectStatus,
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
    let intervalId: number | undefined;

    const fetchData = async () => {
      try {
        const result = await getTranscription(fileId);
        setData(result);

        // Stop polling if completed or error
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

    const shouldPoll = !projectStatus || (projectStatus !== 'completed' && projectStatus !== 'error');

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

  // Initialize segments when data loads
  useEffect(() => {
    // 只要数据就绪且还没有初始化过，就尝试初始化
    // 或者如果 segments 为空（可能是解析失败），可以再试一次（虽然一般不会变）
    if (data?.status === 'completed' && data.transcription?.content && isInitialLoad.current) {
      const initialSegments = extractSegmentsFromContent(data.transcription.content);
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

const TRANSCRIBE_SCENARIO_OPTIONS = [
  { value: 'default', label: '通用模式 (Default)' },
  { value: 'education', label: '教育/讲座 (Education)' },
  { value: 'sports_football', label: '体育/足球解说 (Sports/Football)' }
];

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
  const loadProject = useAppStore(state => state.loadProject);
  const [isEditing, setIsEditing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('original');
  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('en');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationData, setTranslationData] = useState<TranslationResponse | null>(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [stats, setStats] = useState<{ segmentCount: number; duration: number | null; lastSaved: Date | null } | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<number | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!actionsMenuRef.current) return;
      if (!actionsMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
        setActionsMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) {
        window.clearTimeout(pollTimerRef.current);
      }
    };
  }, []);

  const handleExport = async (format: ExportFormat) => {
    if (!project) return;
    setExportingFormat(format);
    try {
      const lang = targetLanguage || 'en';
      const { blob, filename } = await exportTranscription(project.id, format, lang);
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
      setActionsMenuOpen(false);
    }
  };

  const handleEditToggle = () => {
    setIsEditing(!isEditing);
  };

  const startPollingTranslation = (lang: string) => {
    let attempts = 0;
    const maxAttempts = 30;
    const intervalMs = 2500;
    const poll = async () => {
      attempts += 1;
      try {
        const result = await getTranslation(project.id, lang);
        setTranslationData(result);
        setIsTranslating(false);
        setTranslationError(null);
        return;
      } catch (err: any) {
        const status = err?.response?.status;
        if (status === 404) {
          if (attempts >= maxAttempts) {
            setIsTranslating(false);
            setTranslationError('处理超时，请稍后刷新或重试');
            return;
          }
        } else {
          setIsTranslating(false);
          setTranslationError(err?.response?.data?.error || '翻译失败，请稍后重试');
          return;
        }
      }
      pollTimerRef.current = window.setTimeout(poll, intervalMs);
    };
    pollTimerRef.current = window.setTimeout(poll, 200);
  };

  const handleTranslate = async () => {
    if (!project?.id) return;
    setIsTranslating(true);
    setTranslationError(null);
    setTranslationData(null);
    try {
      await requestTranslation(project.id, targetLanguage);
      startPollingTranslation(targetLanguage);
      setShowTranslateModal(false);
    } catch (err: any) {
      setIsTranslating(false);
      setTranslationError(err?.response?.data?.error || '提交翻译任务失败');
    }
  };

  useEffect(() => {
    if (viewMode === 'translated' || viewMode === 'bilingual') {
      if (!translationData && !isTranslating) {
        startPollingTranslation(targetLanguage);
      }
    }
  }, [viewMode, targetLanguage]);

  const handleTriggerRefine = () => {
    alert('润色流程开发中，待 US-6.4 集成后可调用 Ollama 润色稿件');
  };

  const durationLabel = stats?.duration ? `${(stats.duration / 60).toFixed(1)} min` : '未知时长';
  const segmentStat = stats?.segmentCount ? `${stats.segmentCount} 段` : '';
  const translationReady = Boolean(translationData);
  const canStartTranscribe = project.status === 'ready_to_transcribe';
  const canConfirmTranscribe = ['ready_to_transcribe', 'completed', 'error'].includes(project.status);

  const [showTranscribeModal, setShowTranscribeModal] = useState(false);
  const [transcribeScenario, setTranscribeScenario] = useState<string>('default');
  const [teams, setTeams] = useState<Team[]>([]);
  const [transcribeTeamHomeId, setTranscribeTeamHomeId] = useState<string>('');
  const [transcribeTeamAwayId, setTranscribeTeamAwayId] = useState<string>('');
  const [transcribeRosterMode, setTranscribeRosterMode] = useState<RosterMode>('none');
  const [transcribeKeywords, setTranscribeKeywords] = useState<string>('');
  const [transcribeHomeSelected, setTranscribeHomeSelected] = useState<string[]>([]);
  const [transcribeAwaySelected, setTranscribeAwaySelected] = useState<string[]>([]);
  const [transcribePreview, setTranscribePreview] = useState<string | null>(null);
  const [transcribePreviewLoading, setTranscribePreviewLoading] = useState(false);
  const [transcribePreviewTruncated, setTranscribePreviewTruncated] = useState(false);

  const handleOpenTranscribeModal = () => {
    setTranscribeScenario(project.scenario && ['default', 'education', 'sports_football'].includes(project.scenario) ? project.scenario : 'default');
    setTranscribeTeamHomeId('');
    setTranscribeTeamAwayId('');
    setTranscribeRosterMode('none');
    setTranscribeKeywords('');
    setTranscribeHomeSelected([]);
    setTranscribeAwaySelected([]);
    setTranscribePreview(null);
    setTranscribePreviewTruncated(false);
    setShowTranscribeModal(true);
    getTeams().then(setTeams).catch(() => setTeams([]));
  };

  // 提示词预览：弹窗打开且选项变化时请求
  useEffect(() => {
    if (!showTranscribeModal || !project?.id) return;
    const t = setTimeout(() => {
      setTranscribePreviewLoading(true);
      const meta: {
        team_home_id?: string;
        team_away_id?: string;
        keywords?: string;
        roster_mode?: RosterMode;
        selected_players?: string[];
      } = {};
      if (transcribeTeamHomeId) meta.team_home_id = transcribeTeamHomeId;
      if (transcribeTeamAwayId) meta.team_away_id = transcribeTeamAwayId;
      if (transcribeScenario === 'sports_football' && (transcribeTeamHomeId || transcribeTeamAwayId)) {
        meta.roster_mode = transcribeRosterMode;
        if (transcribeRosterMode === 'starting') {
          const selected = [...transcribeHomeSelected, ...transcribeAwaySelected];
          if (selected.length > 0) meta.selected_players = selected;
        }
      }
      if (transcribeKeywords.trim()) meta.keywords = transcribeKeywords.trim();
      getTranscribePreview(project.id, {
        scenario: transcribeScenario,
        meta: Object.keys(meta).length > 0 ? meta : undefined
      })
        .then((r) => {
          setTranscribePreview(r.prompt || '');
          setTranscribePreviewTruncated(Boolean(r.truncated));
        })
        .catch(() => {
          setTranscribePreview(null);
          setTranscribePreviewTruncated(false);
        })
        .finally(() => setTranscribePreviewLoading(false));
    }, 400);
    return () => clearTimeout(t);
  }, [
    showTranscribeModal,
    project?.id,
    transcribeScenario,
    transcribeTeamHomeId,
    transcribeTeamAwayId,
    transcribeRosterMode,
    transcribeHomeSelected,
    transcribeAwaySelected,
    transcribeKeywords
  ]);

  const handleConfirmTranscribe = async () => {
    if (!project?.id || !canConfirmTranscribe) return;
    setIsStarting(true);
    try {
      const meta: {
        team_home_id?: string;
        team_away_id?: string;
        keywords?: string;
        roster_mode?: RosterMode;
        selected_players?: string[];
      } = {};
      if (transcribeTeamHomeId) meta.team_home_id = transcribeTeamHomeId;
      if (transcribeTeamAwayId) meta.team_away_id = transcribeTeamAwayId;
      if (transcribeScenario === 'sports_football' && (transcribeTeamHomeId || transcribeTeamAwayId)) {
        meta.roster_mode = transcribeRosterMode;
        if (transcribeRosterMode === 'starting') {
          const selected = [...transcribeHomeSelected, ...transcribeAwaySelected];
          if (selected.length > 0) meta.selected_players = selected;
        }
      }
      if (transcribeKeywords.trim()) meta.keywords = transcribeKeywords.trim();
      await startTranscription(project.id, {
        scenario: transcribeScenario,
        meta: Object.keys(meta).length > 0 ? meta : undefined
      });
      setShowTranscribeModal(false);
      await loadProject(project.id, true);
    } catch (err: any) {
      console.error(err);
      alert(err?.response?.data?.error || '启动转写失败，请稍后再试');
    } finally {
      setIsStarting(false);
    }
  };

  const toggleSelected = (current: string[], name: string) => {
    return current.includes(name) ? current.filter((n) => n !== name) : [...current, name];
  };

  const homeTeam = teams.find((t) => t.id === transcribeTeamHomeId);
  const awayTeam = teams.find((t) => t.id === transcribeTeamAwayId);
  const homeRosterNames = parseRosterNames(homeTeam?.roster_text);
  const awayRosterNames = parseRosterNames(awayTeam?.roster_text);

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
          {canStartTranscribe && (
            <button
              onClick={handleOpenTranscribeModal}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              disabled={isStarting}
              title="开始转写"
            >
              {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Anchor className="w-4 h-4" />}
              {isStarting ? '启动中...' : '开始转写'}
            </button>
          )}
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
              <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-1 text-xs">
                {(['original', 'translated', 'bilingual'] as ViewMode[]).map((m) => (
                  <button
                    key={m}
                    onClick={() => setViewMode(m)}
                    className={clsx(
                      'px-2 py-1 rounded-full transition-colors',
                      viewMode === m ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    )}
                    title={m === 'original' ? '仅原文' : m === 'translated' ? '仅译文' : '双语对照'}
                  >
                    {m === 'original' && '原文'}
                    {m === 'translated' && '译文'}
                    {m === 'bilingual' && '双语'}
                  </button>
                ))}
              </div>
              {/* 编辑按钮已收进更多菜单 */}
              <button
                onClick={() => setShowTranslateModal(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-indigo-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
                title="AI 翻译"
                disabled={isTranslating}
              >
                <span className="text-base">🌐</span>
                {isTranslating ? '翻译中...' : 'AI 翻译'}
              </button>
              <div className="relative" ref={actionsMenuRef}>
                <button
                  onClick={() => {
                    setActionsMenuOpen((prev) => {
                      const next = !prev;
                      if (!next) setExportMenuOpen(false);
                      return next;
                    });
                  }}
                  className="inline-flex items-center justify-center rounded-full border border-gray-300 p-2 text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
                  title="更多操作"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                {actionsMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 rounded-xl border border-gray-100 bg-white p-1 text-sm shadow-lg z-20">
                    <button
                      onClick={() => {
                        handleOpenTranscribeModal();
                        setActionsMenuOpen(false);
                        setExportMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
                      title="重新转写"
                    >
                      <Anchor className="w-4 h-4 text-blue-500" />
                      重新转写
                    </button>
                    <button
                      onClick={() => {
                        handleEditToggle();
                        setActionsMenuOpen(false);
                        setExportMenuOpen(false);
                      }}
                      className={clsx(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-gray-50',
                        viewMode !== 'original' ? 'text-gray-400' : 'text-gray-700'
                      )}
                      title={isEditing ? "编辑中" : "进入编辑"}
                      disabled={viewMode !== 'original'}
                    >
                      <FileText className="w-4 h-4 text-gray-500" />
                      编辑
                    </button>
                    <button
                      onClick={handleTriggerRefine}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-400"
                      disabled
                      title="AI润色（即将推出）"
                    >
                      <span className="text-base">✨</span>
                      润色
                    </button>
                    <div className="border-t border-gray-100 my-1" />
                    <div className="relative">
                      <button
                        onClick={() => setExportMenuOpen(!exportMenuOpen)}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
                        title="导出"
                      >
                        <span className="flex items-center gap-2">
                          <Download className="w-4 h-4 text-gray-500" />
                          导出
                        </span>
                        <span className="text-gray-400">▸</span>
                      </button>
                      {exportMenuOpen && (
                        <div className="mt-1 rounded-lg border border-gray-100 bg-white p-1 text-sm shadow-sm">
                          {[
                            { format: 'txt', label: 'TXT 文本' },
                            { format: 'json', label: 'JSON 数据' },
                            { format: 'srt', label: 'SRT 字幕' },
                            { format: 'vtt', label: 'VTT 字幕' },
                            { format: 'srt_translated', label: '译文 SRT' },
                            { format: 'srt_bilingual', label: '双语 SRT' },
                          ].map((option) => (
                            <button
                              key={option.format}
                              onClick={() => handleExport(option.format as ExportFormat)}
                              disabled={
                                exportingFormat === option.format ||
                                ((option.format === 'srt_translated' || option.format === 'srt_bilingual') && !translationReady)
                              }
                              className={clsx(
                                'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-gray-50',
                                exportingFormat === option.format ? 'text-gray-400' : 'text-gray-700',
                                (option.format === 'srt_translated' || option.format === 'srt_bilingual') && !translationReady && 'text-gray-400'
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
          viewMode === 'original' ? (
            <TranscriptionResult
              fileId={project.id}
              projectStatus={project.status}
              className="h-full"
              isEditing={isEditing}
              onEditingChange={setIsEditing}
              onSegmentClick={(time) => playerRef.current?.seekTo(time)}
              currentPlayTime={currentPlayTime}
              onStatsChange={setStats}
            />
          ) : (
            <div className="h-full flex flex-col">
              {translationError && (
                <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {translationError}
                </div>
              )}
              {isTranslating && !translationData ? (
                <div className="flex h-full flex-col items-center justify-center text-gray-400">
                  <Loader2 className="w-10 h-10 animate-spin text-blue-200 mb-2" />
                  <p>正在翻译中，请稍候...</p>
                </div>
              ) : (
                <TranslationView
                  projectId={project.id}
                  viewMode={viewMode}
                  translation={translationData}
                  onSegmentClick={(time) => playerRef.current?.seekTo(time)}
                  currentPlayTime={currentPlayTime}
                />
              )}
            </div>
          )
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
                  {getProjectStatusText(project.status, 'long')}
                </p>
                {project.status === 'transcribing' && project.transcription_progress != null && (
                  <div className="w-48 mt-3">
                    <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full transition-all duration-300"
                        style={{ width: `${Math.min(100, project.transcription_progress)}%` }}
                      />
                    </div>
                    <p className="text-xs text-gray-400 mt-1">约 {Math.round(project.transcription_progress)}%</p>
                  </div>
                )}
                <p className="text-xs text-gray-300 mt-2">大文件可能需要较长时间</p>
              </>
            )}
          </div>
        )}
      </div>

      {showTranslateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-lg">
            <h3 className="text-base font-semibold text-gray-800 mb-3">选择目标语言</h3>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="en">英语</option>
              <option value="ja">日语</option>
              <option value="ko">韩语</option>
              <option value="fr">法语</option>
              <option value="de">德语</option>
            </select>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowTranslateModal(false)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                disabled={isTranslating}
              >
                取消
              </button>
              <button
                onClick={handleTranslate}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={isTranslating}
              >
                开始翻译
              </button>
            </div>
          </div>
        </div>
      )}

      {showTranscribeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-gray-800 mb-3">转写选项</h3>
            <p className="text-sm text-gray-500 mb-3">选择场景模式以优化转写效果</p>

            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-1">文件名（将用于辅助识别）</label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
                {project.display_name?.trim() || project.original_name || '—'}
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-sm font-medium text-gray-700 mb-2">场景模式</label>
              <select
                value={transcribeScenario}
                onChange={(e) => setTranscribeScenario(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {TRANSCRIBE_SCENARIO_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>

            {transcribeScenario === 'sports_football' && (
              <>
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">主队</label>
                    <select
                      value={transcribeTeamHomeId}
                      onChange={(e) => {
                        setTranscribeTeamHomeId(e.target.value);
                        setTranscribeHomeSelected([]);
                      }}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">无</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">客队</label>
                    <select
                      value={transcribeTeamAwayId}
                      onChange={(e) => {
                        setTranscribeTeamAwayId(e.target.value);
                        setTranscribeAwaySelected([]);
                      }}
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="">无</option>
                      {teams.map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                {(transcribeTeamHomeId || transcribeTeamAwayId) && (
                  <div className="mb-3">
                    <label className="block text-sm font-medium text-gray-700 mb-2">名单嵌入方式</label>
                    <div className="flex flex-col gap-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="roster_mode"
                          checked={transcribeRosterMode === 'none'}
                          onChange={() => setTranscribeRosterMode('none')}
                          className="text-blue-600"
                        />
                        <span className="text-sm">不嵌入名单（仅对阵信息 + 自定义关键词）</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="roster_mode"
                          checked={transcribeRosterMode === 'full'}
                          onChange={() => setTranscribeRosterMode('full')}
                          className="text-blue-600"
                        />
                        <span className="text-sm">嵌入全部名单</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name="roster_mode"
                          checked={transcribeRosterMode === 'starting'}
                          onChange={() => setTranscribeRosterMode('starting')}
                          className="text-blue-600"
                        />
                        <span className="text-sm">嵌入首发名单（手动选择球员）</span>
                      </label>
                    </div>
                  </div>
                )}
                {transcribeRosterMode === 'starting' && (transcribeTeamHomeId || transcribeTeamAwayId) && (
                  <div className="mb-3 space-y-3">
                    {transcribeTeamHomeId && (
                      <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/60">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-700">主队首发</span>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>已选 {transcribeHomeSelected.length} 人</span>
                            <button
                              type="button"
                              className="text-blue-600 hover:underline"
                              onClick={() => setTranscribeHomeSelected(homeRosterNames)}
                            >
                              全选
                            </button>
                            <button
                              type="button"
                              className="text-gray-500 hover:underline"
                              onClick={() => setTranscribeHomeSelected([])}
                            >
                              清空
                            </button>
                          </div>
                        </div>
                        {homeRosterNames.length === 0 ? (
                          <p className="text-xs text-gray-400">该球队暂无名单，请先在设置中维护球队名单</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {homeRosterNames.map((name) => (
                              <label key={name} className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={transcribeHomeSelected.includes(name)}
                                  onChange={() => setTranscribeHomeSelected(toggleSelected(transcribeHomeSelected, name))}
                                  className="text-blue-600"
                                />
                                <span>{name}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {transcribeTeamAwayId && (
                      <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/60">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-medium text-gray-700">客队首发</span>
                          <div className="flex items-center gap-2 text-xs text-gray-500">
                            <span>已选 {transcribeAwaySelected.length} 人</span>
                            <button
                              type="button"
                              className="text-blue-600 hover:underline"
                              onClick={() => setTranscribeAwaySelected(awayRosterNames)}
                            >
                              全选
                            </button>
                            <button
                              type="button"
                              className="text-gray-500 hover:underline"
                              onClick={() => setTranscribeAwaySelected([])}
                            >
                              清空
                            </button>
                          </div>
                        </div>
                        {awayRosterNames.length === 0 ? (
                          <p className="text-xs text-gray-400">该球队暂无名单，请先在设置中维护球队名单</p>
                        ) : (
                          <div className="grid grid-cols-2 gap-2">
                            {awayRosterNames.map((name) => (
                              <label key={name} className="flex items-center gap-2 text-sm text-gray-700">
                                <input
                                  type="checkbox"
                                  checked={transcribeAwaySelected.includes(name)}
                                  onChange={() => setTranscribeAwaySelected(toggleSelected(transcribeAwaySelected, name))}
                                  className="text-blue-600"
                                />
                                <span>{name}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {transcribeScenario === 'sports_football' ? '补充关键词/名单' : '自定义关键词'}
              </label>
              <textarea
                value={transcribeKeywords}
                onChange={(e) => setTranscribeKeywords(e.target.value)}
                placeholder={transcribeScenario === 'sports_football' ? '可补充球员名、教练名等，多行或逗号分隔' : '多行或逗号分隔，用于提升专有名词识别'}
                rows={3}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">提示词预览</label>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 min-h-[60px]">
                {transcribePreviewLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    加载中…
                  </span>
                ) : transcribePreview !== null && transcribePreview !== '' ? (
                  <span className="whitespace-pre-wrap break-words">{transcribePreview}</span>
                ) : (
                  <span className="text-gray-400">选择场景或填写关键词后将显示实际发送给转写引擎的提示词</span>
                )}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                名单与关键词总长度有上限，过长时靠前的球员名会优先保留，以保证模型识别效果。
              </p>
              {transcribePreviewTruncated && (
                <p className="text-xs text-amber-600 mt-1">
                  提示词已超出长度上限，已自动截断。建议精简名单或减少关键词。
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              {!canConfirmTranscribe && (
                <p className="text-xs text-gray-400">
                  当前状态不可转写，请等待任务完成或失败后重试
                </p>
              )}
              <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowTranscribeModal(false)}
                className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                disabled={isStarting}
              >
                取消
              </button>
              <button
                onClick={handleConfirmTranscribe}
                className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={isStarting || !canConfirmTranscribe}
              >
                {isStarting ? '启动中...' : '开始转写'}
              </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

interface TranslationViewProps {
  projectId: string;
  viewMode: 'translated' | 'bilingual';
  translation: TranslationResponse | null;
  onSegmentClick?: (time: number) => void;
  currentPlayTime: number;
}

const TranslationView: React.FC<TranslationViewProps> = ({
  projectId,
  viewMode,
  translation,
  onSegmentClick,
  currentPlayTime
}) => {
  const [originalSegments, setOriginalSegments] = useState<Segment[]>([]);

  useEffect(() => {
    let mounted = true;
    const loadOriginal = async () => {
      try {
        const res = await getTranscription(projectId);
        const segments = extractSegmentsFromContent(res.transcription?.content);
        if (mounted) setOriginalSegments(segments);
      } catch {
        if (mounted) setOriginalSegments([]);
      }
    };
    loadOriginal();
    return () => { mounted = false; };
  }, [projectId]);

  const translatedSegments = translation?.content?.segments ?? [];

  if (!translation) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-gray-400">
        <AlertCircle className="w-10 h-10 text-amber-200 mb-2" />
        <p>暂无翻译结果，请先点击“AI 翻译”</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pb-6">
      {originalSegments.map((seg, index) => {
        const translated = translatedSegments[index]?.text ?? '';
        const isActive =
          typeof seg.start === 'number' &&
          typeof seg.end === 'number' &&
          currentPlayTime >= seg.start &&
          currentPlayTime <= seg.end;
        return (
          <div
            key={index}
            className={clsx(
              'rounded-lg border border-gray-100 p-3 mb-3 cursor-pointer hover:bg-gray-50 transition-colors',
              isActive && 'border-blue-200 bg-blue-50/50'
            )}
            onClick={() => {
              if (typeof seg.start === 'number') onSegmentClick?.(seg.start);
            }}
          >
            <div className="text-xs text-gray-400 mb-2">
              {typeof seg.start === 'number' ? formatTime(seg.start) : '--:--'}
            </div>
            {viewMode === 'bilingual' && (
              <p className="text-sm text-gray-700 mb-1">{seg.text}</p>
            )}
            <p className="text-sm text-gray-900">{translated || ''}</p>
          </div>
        );
      })}
    </div>
  );
};
