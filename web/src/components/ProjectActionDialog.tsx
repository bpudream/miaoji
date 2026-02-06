import React, { useState, useEffect } from 'react';
import { getProject, Project, updateProjectName } from '../lib/api';
import { getProjectStatusText } from '../lib/status';
import {
  X,
  Trash2,
  HardDrive,
  FileText,
  Clock,
  HardDrive as StorageIcon,
  Calendar,
  Film,
  Music,
  AlertCircle,
  Loader2,
  CheckCircle2,
  Edit2,
  Save,
  X as XIcon
} from 'lucide-react';
import { FileMigrationDialog } from './FileMigrationDialog';

interface ProjectActionDialogProps {
  projectId: string;
  onClose: () => void;
  onDelete?: () => void;
  onMigrationSuccess?: () => void;
}

export const ProjectActionDialog: React.FC<ProjectActionDialogProps> = ({
  projectId,
  onClose,
  onDelete,
  onMigrationSuccess
}) => {
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showMigrationDialog, setShowMigrationDialog] = useState(false);
  const [, setAction] = useState<'none' | 'delete' | 'migrate'>('none');
  const [isEditingName, setIsEditingName] = useState(false);
  const [editedDisplayName, setEditedDisplayName] = useState<string>('');
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    loadProject();
  }, [projectId]);

  const loadProject = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getProject(projectId);
      setProject(data);
    } catch (err: any) {
      setError(err.response?.data?.error || '加载项目信息失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = () => {
    if (confirm('确定要删除这个项目吗？此操作不可恢复。')) {
      setAction('delete');
      onDelete?.();
      onClose();
    }
  };

  const handleMigrate = () => {
    setShowMigrationDialog(true);
  };

  const handleStartEditName = () => {
    if (project) {
      setEditedDisplayName(project.display_name || '');
      setIsEditingName(true);
    }
  };

  const handleCancelEditName = () => {
    setIsEditingName(false);
    setEditedDisplayName('');
  };

  const handleSaveName = async () => {
    if (!project) return;

    setSavingName(true);
    try {
      const result = await updateProjectName(projectId, editedDisplayName.trim() || null);
      setProject({
        ...project,
        display_name: result.display_name
      });
      setIsEditingName(false);
    } catch (err: any) {
      setError(err.response?.data?.error || '更新项目名称失败');
    } finally {
      setSavingName(false);
    }
  };

  // 获取显示名称（优先使用display_name，否则使用original_name）
  const getDisplayName = () => {
    if (!project) return '';
    return project.display_name || project.original_name;
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '-';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
      return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed': return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case 'processing':
      case 'waiting_extract':
      case 'extracting':
      case 'transcribing':
      case 'ready_to_transcribe':
        return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
      case 'cancelled': return <AlertCircle className="w-4 h-4 text-gray-400" />;
      default: return <Clock className="w-4 h-4 text-gray-400" />;
    }
  };

  if (showMigrationDialog && project) {
    return (
      <FileMigrationDialog
        fileIds={[project.id]}
        onClose={() => {
          setShowMigrationDialog(false);
          onClose();
        }}
        onSuccess={() => {
          onMigrationSuccess?.();
          onClose();
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <FileText className="w-5 h-5" />
            项目详情与操作
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : error ? (
            <div className="py-12 text-center">
              <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <p className="text-red-600">{error}</p>
            </div>
          ) : project ? (
            <div className="space-y-6">
              {/* 基本信息 */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-3">基本信息</h3>
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm text-gray-600 flex-shrink-0">项目名称</span>
                    {isEditingName ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          type="text"
                          value={editedDisplayName}
                          onChange={(e) => setEditedDisplayName(e.target.value)}
                          placeholder={project.original_name}
                          className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
                          autoFocus
                        />
                        <button
                          onClick={handleSaveName}
                          disabled={savingName}
                          className="p-1.5 text-green-600 hover:bg-green-50 rounded transition-colors disabled:opacity-50"
                          title="保存"
                        >
                          <Save className="w-4 h-4" />
                        </button>
                        <button
                          onClick={handleCancelEditName}
                          disabled={savingName}
                          className="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
                          title="取消"
                        >
                          <XIcon className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center gap-2 justify-end">
                        <span className="text-sm font-medium text-gray-900 text-right max-w-[70%] break-words">
                          {getDisplayName()}
                        </span>
                        <button
                          onClick={handleStartEditName}
                          className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                          title="编辑名称"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                  {project.display_name && (
                    <div className="flex items-start justify-between text-xs text-gray-500">
                      <span>原始文件名</span>
                      <span className="text-right max-w-[70%] break-words">{project.original_name}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      状态
                    </span>
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      {getStatusIcon(project.status)}
                      {getProjectStatusText(project.status, 'short')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-gray-600 flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      上传时间
                    </span>
                    <span className="text-sm text-gray-900">
                      {new Date(project.created_at).toLocaleString('zh-CN')}
                    </span>
                  </div>
                </div>
              </div>

              {/* 文件信息 */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-3">文件信息</h3>
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  {(project as any).filepath && (
                    <div className="flex items-start justify-between">
                      <span className="text-sm text-gray-600 flex items-center gap-1">
                        <StorageIcon className="w-3 h-3" />
                        存储路径
                      </span>
                      <span className="text-sm text-gray-900 font-mono text-right max-w-[70%] break-all">
                        {(project as any).filepath}
                      </span>
                    </div>
                  )}
                  {(project as any).size && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">文件大小</span>
                      <span className="text-sm font-medium text-gray-900">
                        {formatBytes((project as any).size)}
                      </span>
                    </div>
                  )}
                  {project.duration && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600 flex items-center gap-1">
                        {project.mime_type?.startsWith('video') ? (
                          <Film className="w-3 h-3" />
                        ) : (
                          <Music className="w-3 h-3" />
                        )}
                        时长
                      </span>
                      <span className="text-sm font-medium text-gray-900">
                        {formatDuration(project.duration)}
                      </span>
                    </div>
                  )}
                  {project.mime_type && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">文件类型</span>
                      <span className="text-sm text-gray-900">{project.mime_type}</span>
                    </div>
                  )}
                  {project.audio_path && (
                    <div className="flex items-start justify-between">
                      <span className="text-sm text-gray-600">音频文件</span>
                      <span className="text-sm text-gray-900 font-mono text-right max-w-[70%] break-all">
                        {project.audio_path}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* 处理信息 */}
              <div>
                <h3 className="text-sm font-medium text-gray-500 mb-3">处理信息</h3>
                <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                  {project.transcription && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">转写状态</span>
                      <span className="text-sm text-green-600 font-medium">✓ 已完成</span>
                    </div>
                  )}
                  {!project.transcription && project.status === 'completed' && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">转写状态</span>
                      <span className="text-sm text-gray-400">未转写</span>
                    </div>
                  )}
                  {(project as any).summary_count && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-gray-600">总结数量</span>
                      <span className="text-sm text-gray-900">{(project as any).summary_count} 个</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 操作按钮 */}
              <div className="pt-4 border-t border-gray-200">
                <div className="flex gap-3">
                  <button
                    onClick={handleMigrate}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <HardDrive className="w-4 h-4" />
                    迁移文件
                  </button>
                  <button
                    onClick={handleDelete}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                    删除项目
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
};

