import React, { useState, useEffect } from 'react';
import { Sparkles, Copy, RefreshCw, AlertCircle } from 'lucide-react';
import { generateSummary, getSummary, SummaryMode } from '../lib/api';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';

interface SummaryPanelProps {
  projectId: number;
  transcriptionExists: boolean;
  className?: string;
}

export const SummaryPanel: React.FC<SummaryPanelProps> = ({ projectId, transcriptionExists, className }) => {
  const [summary, setSummary] = useState<string | null>(null);
  const [mode, setMode] = useState<SummaryMode>('brief');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (projectId) {
      fetchSummary(projectId, mode);
    }
  }, [projectId, mode]);

  const fetchSummary = async (id: number, m: SummaryMode) => {
    // Don't auto-fetch if we are already loading something else or have data?
    // Actually, we should try to fetch existing summary for this mode.
    setLoading(true);
    try {
      const res = await getSummary(id, m);
      if (res) {
        setSummary(res.content);
        setError(null);
      } else {
        setSummary(null);
      }
    } catch (err) {
      // Ignore 404 or other errors when fetching existing
      setSummary(null);
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await generateSummary(projectId, mode);
      setSummary(res.summary);
    } catch (err: any) {
      setError(err.response?.data?.error || '生成总结失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (summary) {
      navigator.clipboard.writeText(summary);
    }
  };

  if (!transcriptionExists) {
    return (
      <div className={clsx("flex h-full flex-col rounded-xl border border-gray-100 bg-white p-6 shadow-sm", className)}>
         <h2 className="text-lg font-semibold mb-4 flex items-center gap-2 text-gray-800">
            <Sparkles className="w-5 h-5 text-purple-500" />
            AI 总结
         </h2>
         <div className="flex flex-1 flex-col items-center justify-center text-gray-400 text-sm gap-2">
           <p>请先等待转写完成</p>
           <button
             className="text-xs rounded-full border border-purple-200 px-3 py-1 text-purple-600 hover:bg-purple-50"
             onClick={() => alert('上传完成后自动开启 AI 总结')}
           >
             查看上传进度
           </button>
         </div>
      </div>
    );
  }

  const cleanSummary = (text: string) => {
    if (!text) return '';
    // Remove code block markers if the LLM wrapped the entire output in them
    return text.replace(/^```(?:markdown)?\n/i, '').replace(/\n```$/, '');
  };

  return (
    <div className={clsx("flex h-full flex-col rounded-xl border border-gray-100 bg-white p-6 shadow-sm", className)}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-gray-800">
          <Sparkles className="w-5 h-5 text-purple-500" />
          AI 总结
        </h2>
        <div className="flex gap-2">
           {summary && (
             <button onClick={handleCopy} className="p-1.5 text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors" title="复制">
               <Copy className="w-4 h-4" />
             </button>
           )}
        </div>
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {(['brief', 'detailed', 'key_points'] as SummaryMode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={clsx(
              "px-3 py-1.5 text-sm font-medium rounded-lg transition-colors",
              mode === m
                ? "bg-purple-100 text-purple-700 border border-purple-200"
                : "text-gray-600 hover:bg-gray-50 border border-transparent"
            )}
          >
            {m === 'brief' && '简要'}
            {m === 'detailed' && '详细'}
            {m === 'key_points' && '要点'}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-[200px] overflow-hidden">
        <div className="h-full overflow-y-auto pr-1">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 text-purple-600">
            <RefreshCw className="w-8 h-8 animate-spin mb-2" />
            <p className="text-sm">AI 正在思考中...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center h-48 text-red-500">
            <AlertCircle className="w-8 h-8 mb-2" />
            <p className="text-sm">{error}</p>
            <button onClick={handleGenerate} className="mt-2 text-xs underline hover:text-red-700">重试</button>
          </div>
        ) : summary ? (
           <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed prose-headings:text-gray-900 prose-p:text-gray-700 prose-li:text-gray-700 prose-strong:text-gray-900">
             <ReactMarkdown>{cleanSummary(summary)}</ReactMarkdown>
           </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400 border-2 border-dashed border-gray-100 rounded-lg">
             <Sparkles className="w-8 h-8 mb-2 text-gray-300" />
          <p className="text-sm mb-3">生成当前模式的总结</p>
          <div className="flex gap-2">
            <button
              onClick={handleGenerate}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm font-medium shadow-sm hover:shadow"
            >
              开始生成
            </button>
            <button
              onClick={() => alert('暂未接入，未来将支持重新请求')}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-500 hover:border-purple-200 hover:text-purple-600"
            >
              重新请求
            </button>
          </div>
          </div>
        )}
        </div>
      </div>

      {summary && !loading && (
         <div className="mt-4 flex justify-end">
            <button
              onClick={handleGenerate}
              className="text-xs text-gray-400 hover:text-purple-600 flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> 重新生成
            </button>
         </div>
      )}
    </div>
  );
};

