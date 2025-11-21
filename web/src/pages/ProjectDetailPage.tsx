import { useEffect, useRef, useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import { Clock, FileText, AlertCircle, Loader2, Copy, PlayCircle, Volume2, Download } from 'lucide-react';
import { clsx } from 'clsx';
import { SummaryPanel } from '../components/SummaryPanel';
import { TranscriptionResult } from '../components/TranscriptionResult';
import { exportTranscription, ExportFormat } from '../lib/api';

export const ProjectDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { currentProject, isLoading, error } = useAppStore();
  const timerRef = useRef<NodeJS.Timeout>();
  const isPollingRef = useRef(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);

  // 记录进入转写状态的时间
  const transcriptionStartTimeRef = useRef<number | null>(null);

  // Benchmark 系数：转写耗时 / 音频时长 (假设为 0.15，即 100秒音频需 15秒转写)
  const TRANSCRIPTION_RATIO = 0.15;

  // 当进入转写状态时，记录开始时间
  useEffect(() => {
    if (currentProject?.status === 'transcribing' && !transcriptionStartTimeRef.current) {
      transcriptionStartTimeRef.current = Date.now();
      console.log(`[Poll] Transcription started at ${new Date(transcriptionStartTimeRef.current).toLocaleTimeString()}`);
    }
  }, [currentProject?.status]);

  // 动态计算下一次轮询间隔
  const getNextPollInterval = useCallback(() => {
    // 如果不是转写状态，或者没有时长信息，或者还没开始计时，使用默认短间隔
    if (useAppStore.getState().currentProject?.status !== 'transcribing' ||
        !useAppStore.getState().currentProject?.duration ||
        !transcriptionStartTimeRef.current) {
      return 1000;
    }

    const project = useAppStore.getState().currentProject!;
    const elapsed = (Date.now() - transcriptionStartTimeRef.current) / 1000;
    const estimatedTotal = project.duration! * TRANSCRIPTION_RATIO;
    const remaining = Math.max(0, estimatedTotal - elapsed);

    if (remaining > 20) return 5000; // 还早，5秒一次
    if (remaining > 10) return 2000; // 快了，2秒一次
    return 500; // 冲刺阶段，0.5秒一次
  }, []);

  // 使用 ref 保存最新的 loadProject，避免闭包问题
  const loadProjectRef = useRef(useAppStore.getState().loadProject);
  useEffect(() => {
    loadProjectRef.current = useAppStore.getState().loadProject;
  });

  useEffect(() => {
    if (!id) return;

    const projectId = Number(id);

    console.log(`[Poll] Starting polling for project ${projectId}`);

    // 立即加载一次
    loadProjectRef.current(projectId);

    // 设置轮询：在处理过程中持续轮询
    isPollingRef.current = true;

    // 重置开始时间
    transcriptionStartTimeRef.current = null;

    const scheduleNextPoll = () => {
      if (!isPollingRef.current) {
         console.log(`[Poll] Polling stopped by flag for project ${projectId}`);
         return;
      }

      const interval = getNextPollInterval();
      // console.log(`[Poll] Next poll in ${interval}ms`);

      timerRef.current = setTimeout(async () => {
        if (!isPollingRef.current) return;

        // console.log(`[Poll] Fetching status for project ${projectId}`);
        await loadProjectRef.current(projectId, true);

        // 递归调度下一次
        scheduleNextPoll();
      }, interval);
    };

    // 启动第一次调度
    scheduleNextPoll();

    // 清理函数
    return () => {
      console.log(`[Poll] Cleanup: stopping polling for project ${projectId}`);
      isPollingRef.current = false;
      if (timerRef.current) {
        clearTimeout(timerRef.current); // 注意这里改成 clearTimeout
        timerRef.current = undefined;
      }
    };
  }, [id, getNextPollInterval]); // ✅ 只依赖 id 和 getNextPollInterval

  // ... (Rest of the component)

  // 当状态为 completed 或 error 时停止轮询
  useEffect(() => {
    // 🔍 关键修复：必须检查当前 store 中的项目 ID 是否与路由 ID 一致
    // 防止 store 中残留的旧项目状态（如上一个已完成的项目）误触发停止逻辑
    if (currentProject && String(currentProject.id) === id) {
      const status = currentProject.status;
      if (status === 'completed' || status === 'error') {
        console.log(`[Poll] Task finished with status: ${status}, stopping polling`);
        isPollingRef.current = false;
        if (timerRef.current) {
          clearTimeout(timerRef.current);
          timerRef.current = undefined;
        }
      }
    }
  }, [currentProject, id]);

  // 组件卸载时清理 store，防止状态残留影响下一次进入
  useEffect(() => {
    return () => {
      useAppStore.getState().clearCurrentProject();
    };
  }, []);

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

  // ⚠️ 重要：所有 hooks 必须在早期返回之前调用
  const [playerMode, setPlayerMode] = useState<'audio' | 'video'>('audio'); // 默认音频模式
  const [isEditing, setIsEditing] = useState(false); // 编辑状态，由TranscriptionResult控制

  const handleExport = async (format: ExportFormat) => {
    if (!currentProject) return;
    setExportingFormat(format);
    try {
      const { blob, filename } = await exportTranscription(currentProject.id, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const fallbackName = `${currentProject.original_name || currentProject.filename || 'transcription'}.${format}`;
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

  // 早期返回必须在所有 hooks 之后
  if (isLoading && !currentProject) return <div className="p-8 text-center">加载中...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (!currentProject) return <div className="p-8 text-center">项目不存在</div>;

  const getStatusText = (status: string) => {
    const statusMap: Record<string, string> = {
      pending: '等待中',
      extracting: '提取音频',
      ready_to_transcribe: '准备转写',
      transcribing: '转写中',
      processing: '处理中',
      completed: '已完成',
      error: '错误'
    };
    return statusMap[status] || status;
  };

  const statusColor = {
    completed: 'text-green-600 bg-green-50 border-green-200',
    processing: 'text-blue-600 bg-blue-50 border-blue-200',
    extracting: 'text-indigo-600 bg-indigo-50 border-indigo-200',
    transcribing: 'text-blue-600 bg-blue-50 border-blue-200',
    ready_to_transcribe: 'text-blue-600 bg-blue-50 border-blue-200',
    pending: 'text-gray-600 bg-gray-50 border-gray-200',
    error: 'text-red-600 bg-red-50 border-red-200',
  }[currentProject.status] || 'text-gray-600 bg-gray-50 border-gray-200';

  // 判断是否为视频文件
  const isVideo = currentProject.mime_type?.startsWith('video/') ?? false;

  // 根据播放模式动态调整面板高度
  const getPlayerHeightRatio = () => {
    if (!isVideo) return 0.3; // 纯音频文件，播放器占30%
    if (playerMode === 'audio') return 0.3; // 视频文件但音频模式，播放器占30%
    return 0.6; // 视频模式，播放器占60%
  };

  const playerHeightRatio = getPlayerHeightRatio();
  const summaryHeightRatio = 1 - playerHeightRatio;

  const handleVersionPanel = () => {
    alert('版本管理面板开发中，待 US-6.5 完成后可切换历史版本');
  };

  const handleTriggerRefine = () => {
    alert('润色流程开发中，待 US-6.4 集成后可调用 Ollama 润色稿件');
  };

  const handleEditToggle = () => {
    setIsEditing(!isEditing);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 mb-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{currentProject.original_name}</h1>
              <div className="flex items-center gap-4 text-sm text-gray-500">
                <span className="flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  {new Date(currentProject.created_at).toLocaleString()}
                </span>
                <span className={clsx("px-2.5 py-0.5 rounded-full text-xs font-medium border flex items-center gap-1", statusColor)}>
                  {['processing', 'extracting', 'transcribing', 'ready_to_transcribe'].includes(currentProject.status) && (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  )}
                  {getStatusText(currentProject.status)}
                </span>
              </div>
            </div>
            <div />
          </div>
        </div>
      </div>

      <div className="flex-1 grid gap-6 lg:grid-cols-12 overflow-hidden min-h-0">
        <div className="space-y-6 lg:col-span-6 flex flex-col overflow-hidden min-h-0">
          <div className="grid h-full gap-6 min-h-0" style={{ gridTemplateRows: `${playerHeightRatio * 100}% ${summaryHeightRatio * 100}%` }}>
            <MediaPlayerPanel
              projectName={currentProject.original_name}
              duration={currentProject.duration}
              isVideo={isVideo}
              playerMode={playerMode}
              onModeChange={setPlayerMode}
            />
            <div className="h-full overflow-hidden min-h-0">
              <SummaryPanel
                projectId={currentProject.id}
                transcriptionExists={!!(currentProject.transcription && currentProject.transcription.content)}
                className="h-full"
              />
            </div>
          </div>
        </div>

        <div className="lg:col-span-6 flex flex-col overflow-hidden min-h-0">
          <div className="flex h-full flex-col rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden">
            <div className="flex-shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-gray-800">
                <FileText className="w-5 h-5 text-blue-500" />
                转写内容
              </h2>
              <div className="flex items-center gap-2">
                {currentProject.transcription && (
                  <button
                    className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded hover:bg-blue-50"
                    onClick={() => {
                      const content = currentProject.transcription?.content;
                      const text = typeof content === 'object' ? (content.text || JSON.stringify(content)) : content;
                      navigator.clipboard.writeText(text || '');
                    }}
                    title="复制全文"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                )}
                {currentProject.status === 'completed' && (
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

            <div className="flex-1 overflow-hidden px-6">
              {currentProject.status === 'completed' ? (
                <TranscriptionResult
                  fileId={currentProject.id}
                  className="h-full"
                  isEditing={isEditing}
                  onEditingChange={setIsEditing}
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center text-gray-400">
                  {currentProject.status === 'error' ? (
                    <>
                      <AlertCircle className="w-12 h-12 text-red-200 mb-2" />
                      <p>转写失败</p>
                    </>
                  ) : (
                    <>
                      <Loader2 className="w-12 h-12 animate-spin text-blue-100 mb-2" />
                      <p>
                        {currentProject.status === 'extracting' ? '正在提取音频...' :
                         currentProject.status === 'transcribing' ? '正在AI转写中...' :
                         '正在处理中，请稍候...'}
                      </p>
                      <p className="text-xs text-gray-300 mt-2">大文件可能需要较长时间</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

interface MediaPlayerPanelProps {
  projectName: string;
  duration?: number;
  isVideo: boolean;
  playerMode: 'audio' | 'video';
  onModeChange: (mode: 'audio' | 'video') => void;
}

const MediaPlayerPanel: React.FC<MediaPlayerPanelProps> = ({ projectName, duration, isVideo, playerMode, onModeChange }) => {
  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-100 bg-white p-6 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between pb-4 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <PlayCircle className="w-5 h-5 text-indigo-500" />
            播放器
          </h2>
          <p className="text-xs text-gray-400 mt-1">
            {duration ? `时长约 ${(duration / 60).toFixed(1)} 分钟` : '等待计算时长'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isVideo && (
            <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 p-1">
              <button
                onClick={() => onModeChange('audio')}
                className={clsx(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                  playerMode === 'audio'
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                音频
              </button>
              <button
                onClick={() => onModeChange('video')}
                className={clsx(
                  "px-2.5 py-1 text-xs font-medium rounded-md transition-colors",
                  playerMode === 'video'
                    ? "bg-white text-indigo-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                视频
              </button>
            </div>
          )}
          <button className="inline-flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-500">
            <Volume2 className="w-4 h-4" />
            静音
          </button>
        </div>
      </div>
      <div className="flex flex-1 flex-col rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-4 text-center text-sm text-gray-400 overflow-hidden">
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <PlayCircle className="w-10 h-10 text-gray-300" />
          <p>
            将在此嵌入 <strong>{projectName}</strong> 的{playerMode === 'video' ? '视频' : '音频'}播放器，并支持与段落的联动播放
          </p>
        </div>
        <div className="rounded-md bg-white py-2 px-3 text-xs text-gray-500">
          未来可直接点击段落跳转到对应时间，播放器自动保持同步
        </div>
      </div>
    </div>
  );
};
