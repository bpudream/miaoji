import React from 'react';
import { AlertCircle, ExternalLink, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { DuplicateFileInfo, Project } from '../lib/api';
import { getProjectStatusText } from '../lib/status';

interface DuplicateFileDialogProps {
  duplicate: DuplicateFileInfo;
  onContinue: () => void;
  onCancel: () => void;
}

export const DuplicateFileDialog: React.FC<DuplicateFileDialogProps> = ({
  duplicate,
  onContinue,
  onCancel
}) => {
  const navigate = useNavigate();

  const handleViewProject = () => {
    navigate(`/projects/${duplicate.id}`);
    onCancel();
  };

  const getStatusColor = (status: string) => {
    const colorMap: Record<string, string> = {
      completed: 'text-green-600 bg-green-50 border-green-200',
      processing: 'text-blue-600 bg-blue-50 border-blue-200',
      waiting_extract: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      extracting: 'text-indigo-600 bg-indigo-50 border-indigo-200',
      transcribing: 'text-blue-600 bg-blue-50 border-blue-200',
      ready_to_transcribe: 'text-blue-600 bg-blue-50 border-blue-200',
      pending: 'text-gray-600 bg-gray-50 border-gray-200',
      cancelled: 'text-gray-500 bg-gray-100 border-gray-200',
      error: 'text-red-600 bg-red-50 border-red-200',
    };
    return colorMap[status] || 'text-gray-600 bg-gray-50 border-gray-200';
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full">
        <div className="p-6">
          <div className="flex items-start gap-4 mb-6">
            <div className="flex-shrink-0 w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                检测到相同文件已存在
              </h3>
              <p className="text-sm text-gray-600">
                您要上传的文件与已有项目相同，建议查看已有项目。
              </p>
            </div>
            <button
              onClick={onCancel}
              className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="bg-gray-50 rounded-lg p-4 mb-6 space-y-3">
            <div>
              <div className="text-xs text-gray-500 mb-1">项目名称</div>
              <div className="text-sm font-medium text-gray-900">{duplicate.name}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">原始文件名</div>
              <div className="text-sm text-gray-700">{duplicate.original_name}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">状态</div>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(duplicate.status)}`}>
                {getProjectStatusText(duplicate.status as Project['status'], 'short')}
              </span>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">创建时间</div>
              <div className="text-sm text-gray-700">
                {new Date(duplicate.created_at).toLocaleString('zh-CN')}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={handleViewProject}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
              查看已有项目
            </button>
            <button
              onClick={onContinue}
              className="w-full px-4 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
            >
              仍要上传（创建新项目）
            </button>
            <button
              onClick={onCancel}
              className="w-full px-4 py-2 text-gray-600 hover:text-gray-800 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

