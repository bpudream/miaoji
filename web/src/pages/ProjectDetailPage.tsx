import React, { useEffect, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import { ArrowLeft, Clock, FileText, CheckCircle2, AlertCircle, Loader2, Copy } from 'lucide-react';
import { clsx } from 'clsx';

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

  return (
    <div>
      <div className="mb-6">
        <Link to="/" className="text-gray-500 hover:text-gray-900 flex items-center gap-1 mb-4 transition-colors w-fit">
          <ArrowLeft className="w-4 h-4" /> 返回列表
        </Link>

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
            <div className="flex gap-2">
              {/* Action Buttons */}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          {/* Transcription Content */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 min-h-[400px]">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-gray-800">
                <FileText className="w-5 h-5 text-blue-500" />
                转写内容
              </h2>
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
            </div>

            {currentProject.status === 'completed' ? (
              <div className="prose max-w-none text-gray-700 whitespace-pre-wrap leading-relaxed">
                {(() => {
                  const content = currentProject.transcription?.content;
                  if (!content) return '转写内容为空';
                  if (typeof content === 'object') {
                    return content.text || JSON.stringify(content, null, 2);
                  }
                  return content;
                })()}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-gray-400">
                {currentProject.status === 'error' ? (
                  <>
                    <AlertCircle className="w-12 h-12 text-red-200 mb-2" />
                    <p>转写失败</p>
                    {/* 显示错误信息（如果 API 返回了 error_message 字段，目前类型没加，暂不显示） */}
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

        <div className="col-span-1 space-y-6">
          {/* AI Summary Placeholder */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 h-fit">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-800">
              <span>✨</span> AI 总结
            </h2>
            <p className="text-gray-400 text-sm bg-gray-50 p-4 rounded-lg border border-gray-100">
              AI 总结功能正在开发中 (Sprint 4)...
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
