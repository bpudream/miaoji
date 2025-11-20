import React, { useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import { ArrowLeft, Clock, FileText, CheckCircle2, AlertCircle, Loader2, Copy } from 'lucide-react';
import { clsx } from 'clsx';

export const ProjectDetailPage = () => {
  const { id } = useParams<{ id: string }>();
  const { currentProject, loadProject, isLoading, error } = useAppStore();
  const timerRef = useRef<NodeJS.Timeout>();

  useEffect(() => {
    if (id) {
      loadProject(Number(id));
      // 轮询状态
      timerRef.current = setInterval(() => {
        loadProject(Number(id));
      }, 3000);
      return () => clearInterval(timerRef.current);
    }
  }, [id, loadProject]);

  // 当状态为 completed 或 error 时停止轮询
  useEffect(() => {
    if (currentProject?.status === 'completed' || currentProject?.status === 'error') {
      clearInterval(timerRef.current);
    }
  }, [currentProject?.status]);

  if (isLoading && !currentProject) return <div className="p-8 text-center">加载中...</div>;
  if (error) return <div className="p-8 text-center text-red-500">{error}</div>;
  if (!currentProject) return <div className="p-8 text-center">项目不存在</div>;

  const statusColor = {
    completed: 'text-green-600 bg-green-50 border-green-200',
    processing: 'text-blue-600 bg-blue-50 border-blue-200',
    pending: 'text-gray-600 bg-gray-50 border-gray-200',
    error: 'text-red-600 bg-red-50 border-red-200',
  }[currentProject.status];

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
                  {currentProject.status === 'processing' && <Loader2 className="w-3 h-3 animate-spin" />}
                  {currentProject.status.toUpperCase()}
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
                  </>
                ) : (
                  <>
                    <Loader2 className="w-12 h-12 animate-spin text-blue-100 mb-2" />
                    <p>正在处理中，请稍候...</p>
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

