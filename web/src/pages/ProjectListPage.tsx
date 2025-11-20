import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import { FileText, Trash2, Clock, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

export const ProjectListPage = () => {
  const { projects, loadProjects, isLoading, removeProject } = useAppStore();

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const handleDelete = async (e: React.MouseEvent, id: number) => {
    e.preventDefault(); // 阻止跳转
    if (confirm('确定要删除这个项目吗？此操作不可恢复。')) {
      await removeProject(id);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-5 h-5 text-green-500" />;
      case 'processing':
      case 'extracting':
      case 'transcribing':
      case 'ready_to_transcribe':
        return <Loader2 className="w-5 h-5 text-blue-500 animate-spin" />;
      case 'error': return <AlertCircle className="w-5 h-5 text-red-500" />;
      default: return <Clock className="w-5 h-5 text-gray-400" />;
    }
  };

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

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">所有项目</h2>
        <Link to="/upload" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
          新建上传
        </Link>
      </div>

      {isLoading && projects.length === 0 ? (
        <div className="text-center py-20">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-4" />
          <p className="text-gray-500">加载中...</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map(project => (
            <Link key={project.id} to={`/projects/${project.id}`} className="block group">
              <div className="bg-white p-6 rounded-xl shadow-sm hover:shadow-md transition-all border border-gray-100 hover:border-blue-200 relative">
                <div className="flex items-start justify-between mb-4">
                  <div className="p-3 bg-blue-50 rounded-lg text-blue-600">
                    <FileText className="w-6 h-6" />
                  </div>
                  <button
                    onClick={(e) => handleDelete(e, project.id)}
                    className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-all opacity-0 group-hover:opacity-100"
                    title="删除项目"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
                <h3 className="font-semibold text-gray-900 truncate mb-2" title={project.original_name}>
                  {project.original_name}
                </h3>
                <div className="flex items-center justify-between text-sm text-gray-500 mt-4">
                  <span className="flex items-center gap-1.5">
                    {getStatusIcon(project.status)}
                    <span className="font-medium">{getStatusText(project.status)}</span>
                  </span>
                  <span>{new Date(project.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {!isLoading && projects.length === 0 && (
        <div className="text-center py-20 bg-white rounded-xl border border-dashed border-gray-300">
          <div className="bg-gray-50 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <UploadIcon className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">还没有项目</h3>
          <p className="text-gray-500 mb-4">上传你的第一个音视频文件开始转写</p>
          <Link to="/upload" className="text-blue-600 hover:underline font-medium">
            去上传 &rarr;
          </Link>
        </div>
      )}
    </div>
  );
};

const UploadIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
  </svg>
);

