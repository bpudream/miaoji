import { useEffect, useRef, useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import { Clock, Loader2, ChevronDown, ChevronUp } from 'lucide-react';
import { clsx } from 'clsx';
import { SummaryPanel } from '../components/SummaryPanel';
import { TranscriptionPanel } from '../components/TranscriptionResult';
import { MediaPlayerPanel, MediaPlayerRef } from '../components/MediaPlayer';

export const ProjectDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { currentProject, isLoading, error } = useAppStore();
  const timerRef = useRef<NodeJS.Timeout>();
  const isPollingRef = useRef(false);

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

  // ⚠️ 重要：所有 hooks 必须在早期返回之前调用
  const [playerMode, setPlayerMode] = useState<'audio' | 'video'>('audio'); // 默认音频模式
  const [isSummaryCollapsed, setIsSummaryCollapsed] = useState(false);
  const playerRef = useRef<MediaPlayerRef>(null);
  const [currentPlayTime, setCurrentPlayTime] = useState(0);

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

  const summaryVisible = !isSummaryCollapsed;
  const playerHeightRatio = getPlayerHeightRatio();
  const summaryHeightRatio = 1 - playerHeightRatio;
  const gridTemplateRows = summaryVisible
    ? `${playerHeightRatio * 100}% ${summaryHeightRatio * 100}%`
    : '1fr';

  const handleSummaryToggle = () => {
    setIsSummaryCollapsed((prev) => !prev);
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="detail-title-box flex-shrink-0 mb-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 mb-2">{currentProject.display_name || currentProject.original_name}</h1>
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

      <div className="detail-content-box flex-1 grid gap-6 lg:grid-cols-12 overflow-hidden min-h-0">
        <div className="detail-content-left-box lg:col-span-6 flex space-y-6 flex-col min-h-0">
          <div className="detail-content-left-inner-box grid flex-1 space-y-6 min-h-0 overflow-hidden" style={{ gridTemplateRows }}>
            <MediaPlayerPanel
              projectId={currentProject.id}
              projectName={currentProject.display_name || currentProject.original_name}
              duration={currentProject.duration}
              isVideo={isVideo}
              hasAudioPath={!!currentProject.audio_path}
              playerMode={playerMode}
              onModeChange={setPlayerMode}
              playerRef={playerRef}
              onTimeUpdate={setCurrentPlayTime}
            />
            <div
              className={clsx(
                "detail-content-left-summary-box relative rounded-xl border border-gray-100 bg-white shadow-sm min-h-0 transition-all flex flex-col",
                summaryVisible ? "pt-6" : "hidden"
              )}
            >
              <button
                onClick={handleSummaryToggle}
                className={clsx(
                  "detail-content-left-summary-toggle-button absolute left-1/2 -translate-x-1/2 -top-2.5 flex items-center gap-1 rounded-full border bg-white px-4 py-1.5 text-xs font-medium shadow transition-all z-30",
                  summaryVisible
                    ? "border-purple-200 text-purple-500 hover:bg-purple-50"
                    : "border-gray-200 text-gray-500 hover:bg-gray-50"
                )}
                title={summaryVisible ? "收起 AI 总结" : "展开 AI 总结"}
              >
                {summaryVisible ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
              <div className="detail-content-left-summary-content-box flex-1 overflow-hidden px-5 pb-5 min-h-0">
                <SummaryPanel
                  projectId={currentProject.id}
                  transcriptionExists={!!(currentProject.transcription && currentProject.transcription.content)}
                  className="h-full"
                />
              </div>
            </div>
          </div>
          {!summaryVisible && (
            <div className="detail-content-left-summary-replacement-box relative rounded-xl border border-dashed border-gray-200 bg-white py-8 text-sm text-gray-400 text-center">
              <button
                onClick={handleSummaryToggle}
                className="absolute left-1/2 -translate-x-1/2 -top-2.5 flex items-center gap-1 rounded-full border bg-white px-4 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-50 transition-all shadow z-30"
                title="展开 AI 总结"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              AI 总结已折叠，点击上方按钮展开
            </div>
          )}
        </div>

        <div className="detail-content-right-box lg:col-span-6 flex flex-col overflow-hidden min-h-0">
          <TranscriptionPanel
            project={currentProject}
            playerRef={playerRef}
            currentPlayTime={currentPlayTime}
            className="h-full"
          />
        </div>
      </div>
    </div>
  );
};

