import { useEffect, useRef, useCallback, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useAppStore } from '../../stores/useAppStore';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { SummaryPanel } from '../../components/SummaryPanel';
import { TranscriptionPanel } from '../../components/TranscriptionResult';
import { MediaPlayer, MediaPlayerRef } from '../../components/MediaPlayer';

export const MobileProjectDetailPage = () => {
    const { id } = useParams<{ id: string }>();
    const { currentProject, isLoading, error } = useAppStore();
    const timerRef = useRef<NodeJS.Timeout>();
    const isPollingRef = useRef(false);
    const transcriptionStartTimeRef = useRef<number | null>(null);
    const TRANSCRIPTION_RATIO = 0.15;

    // 复用原来的轮询逻辑 (逻辑完全一样，只是 UI 不同)
    // ------------------------------------------------------------
    const getNextPollInterval = useCallback(() => {
        if (useAppStore.getState().currentProject?.status !== 'transcribing' ||
            !useAppStore.getState().currentProject?.duration ||
            !transcriptionStartTimeRef.current) {
            return 1000;
        }
        const project = useAppStore.getState().currentProject!;
        const elapsed = (Date.now() - transcriptionStartTimeRef.current) / 1000;
        const estimatedTotal = project.duration! * TRANSCRIPTION_RATIO;
        const remaining = Math.max(0, estimatedTotal - elapsed);
        if (remaining > 20) return 5000;
        if (remaining > 10) return 2000;
        return 500;
    }, []);

    const loadProjectRef = useRef(useAppStore.getState().loadProject);
    useEffect(() => { loadProjectRef.current = useAppStore.getState().loadProject; });

    useEffect(() => {
        if (!id) return;
        const projectId = Number(id);
        loadProjectRef.current(projectId);
        isPollingRef.current = true;
        transcriptionStartTimeRef.current = null;

        const scheduleNextPoll = () => {
            if (!isPollingRef.current) return;
            const interval = getNextPollInterval();
            timerRef.current = setTimeout(async () => {
                if (!isPollingRef.current) return;
                await loadProjectRef.current(projectId, true);
                scheduleNextPoll();
            }, interval);
        };
        scheduleNextPoll();

        return () => {
            isPollingRef.current = false;
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = undefined;
            }
        };
    }, [id, getNextPollInterval]);

    useEffect(() => {
        if (currentProject?.status === 'transcribing' && !transcriptionStartTimeRef.current) {
            transcriptionStartTimeRef.current = Date.now();
        }
    }, [currentProject?.status]);

    useEffect(() => {
        if (currentProject && String(currentProject.id) === id) {
            const status = currentProject.status;
            if (status === 'completed' || status === 'error') {
                isPollingRef.current = false;
                if (timerRef.current) clearTimeout(timerRef.current);
            }
        }
    }, [currentProject, id]);

    useEffect(() => {
        return () => { useAppStore.getState().clearCurrentProject(); };
    }, []);
    // ------------------------------------------------------------

    const [playerMode, setPlayerMode] = useState<'audio' | 'video'>('audio');
    const [isSummaryCollapsed, setIsSummaryCollapsed] = useState(false);
    const playerRef = useRef<MediaPlayerRef>(null);
    const [currentPlayTime, setCurrentPlayTime] = useState(0);

    if (isLoading && !currentProject) return <div className="p-8 text-center text-sm">加载中...</div>;
    if (error) return <div className="p-8 text-center text-red-500 text-sm">{error}</div>;
    if (!currentProject) return <div className="p-8 text-center text-sm">项目不存在</div>;

    const isVideo = currentProject.mime_type?.startsWith('video/') ?? false;

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* 1. 顶部固定播放器区域 */}
            <div className="flex-shrink-0 bg-white border-b border-gray-200 sticky top-0 z-10">
                 {/* 简单的标题栏 */}
                 <div className="px-4 py-2 flex items-center justify-between border-b border-gray-100">
                    <h1 className="text-sm font-bold text-gray-900 truncate max-w-[70%]">{currentProject.original_name}</h1>
                    <div className="flex gap-2">
                         {isVideo && (
                            <button
                                onClick={() => setPlayerMode(playerMode === 'audio' ? 'video' : 'audio')}
                                className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-600"
                            >
                                {playerMode === 'audio' ? '看视频' : '听音频'}
                            </button>
                         )}
                    </div>
                 </div>

                 {/* 播放器本体 - 限制高度，使用视口比例固定高度，确保 Flex 布局生效 */}
                 <div style={{ height: playerMode === 'video' ? '60vh' : '180px', maxHeight: '720px' }} className="w-full bg-black/5 overflow-hidden transition-all duration-300 flex flex-col">
                    <MediaPlayer
                        ref={playerRef}
                        projectId={currentProject.id}
                        isVideo={isVideo}
                        hasAudioPath={!!currentProject.audio_path}
                        playerMode={playerMode}
                        onTimeUpdate={setCurrentPlayTime}
                        className="flex-1 min-h-0"
                    />
                 </div>
            </div>

            {/* 2. 可滚动的下方内容区域 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                 {/* AI 总结卡片 */}
                 <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div
                        className="flex items-center justify-between p-3 bg-gray-50/50 border-b border-gray-100 cursor-pointer"
                        onClick={() => setIsSummaryCollapsed(!isSummaryCollapsed)}
                    >
                        <span className="text-sm font-medium text-gray-700">AI 总结</span>
                        {isSummaryCollapsed ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
                    </div>
                    {!isSummaryCollapsed && (
                        <div className="h-64">
                            <SummaryPanel
                                projectId={currentProject.id}
                                transcriptionExists={!!(currentProject.transcription && currentProject.transcription.content)}
                                className="h-full border-none shadow-none"
                            />
                        </div>
                    )}
                 </div>

                 {/* 转写内容 */}
                 <div className="bg-white rounded-xl shadow-sm border border-gray-100 min-h-[400px]">
                      <TranscriptionPanel
                        project={currentProject}
                        playerRef={playerRef}
                        currentPlayTime={currentPlayTime}
                        className="h-full border-none shadow-none rounded-none"
                      />
                 </div>
            </div>
        </div>
    );
};

