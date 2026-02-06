import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAppStore } from '../stores/useAppStore';
import { FileText, Trash2, Clock, CheckCircle2, AlertCircle, Loader2, HardDrive, MoreVertical } from 'lucide-react';
import { FileMigrationDialog } from '../components/FileMigrationDialog';
import { ProjectActionDialog } from '../components/ProjectActionDialog';
import { getProjectStatusText } from '../lib/status';

export const ProjectListPage = () => {
  const { projects, loadProjects, isLoading, removeProject } = useAppStore();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showMigrationDialog, setShowMigrationDialog] = useState(false);
  const [migrationFileIds, setMigrationFileIds] = useState<string[]>([]);
  const [showActionDialog, setShowActionDialog] = useState(false);
  const [actionDialogProjectId, setActionDialogProjectId] = useState<string | null>(null);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);


  const handleOpenActionDialog = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setActionDialogProjectId(projectId);
    setShowActionDialog(true);
  };

  const handleActionDialogDelete = async () => {
    if (actionDialogProjectId) {
      await removeProject(actionDialogProjectId);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(actionDialogProjectId);
        return next;
      });
      await loadProjects();
    }
  };

  const handleActionDialogMigrationSuccess = async () => {
    await loadProjects();
    setSelectedIds(new Set<string>());
  };

  const handleSelect = (id: string, checked: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (checked) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new Set<string>(projects.map(p => p.id)));
    } else {
      setSelectedIds(new Set<string>());
    }
  };

  const handleMigrate = (fileIds: string[]) => {
    setMigrationFileIds(fileIds);
    setShowMigrationDialog(true);
  };

  const handleMigrationSuccess = () => {
    loadProjects(); // 重新加载项目列表
    setSelectedIds(new Set<string>()); // 清空选择
  };

  const handleBatchDelete = async () => {
    const count = selectedIds.size;
    if (count === 0) return;

    const message = `确定要删除选中的 ${count} 个项目吗？此操作不可恢复。`;
    if (!confirm(message)) {
      return;
    }

    // 批量删除
    const idsToDelete = Array.from(selectedIds);
    let successCount = 0;
    let failCount = 0;

    for (const id of idsToDelete) {
      try {
        await removeProject(id);
        successCount++;
      } catch (error) {
        console.error(`Failed to delete project ${id}:`, error);
        failCount++;
      }
    }

    // 清空选择
    setSelectedIds(new Set<string>());

    // 显示结果
    if (failCount > 0) {
      alert(`删除完成：成功 ${successCount} 个，失败 ${failCount} 个`);
    } else {
      // 重新加载项目列表以确保数据同步
      await loadProjects();
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

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">所有项目</h2>
        <div className="flex items-center gap-3">
          {selectedIds.size > 0 && (
            <>
              <button
                onClick={() => handleMigrate(Array.from(selectedIds))}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors"
              >
                <HardDrive className="w-4 h-4" />
                迁移选中 ({selectedIds.size})
              </button>
              <button
                onClick={handleBatchDelete}
                className="flex items-center gap-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                删除选中 ({selectedIds.size})
              </button>
              <button
                onClick={() => setSelectedIds(new Set<string>())}
                className="text-gray-600 hover:text-gray-800 px-3 py-2"
              >
                取消选择
              </button>
            </>
          )}
          <Link to="/upload" className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors">
            新建上传
          </Link>
        </div>
      </div>

      {projects.length > 0 && (
        <div className="mb-4 flex items-center gap-4 p-3 bg-gray-50 rounded-lg border border-gray-200">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={selectedIds.size === projects.length && projects.length > 0}
              onChange={(e) => handleSelectAll(e.target.checked)}
              className="rounded"
            />
            <span className="text-sm text-gray-700">全选</span>
          </label>
          {selectedIds.size > 0 && (
            <span className="text-sm text-gray-600">
              已选择 {selectedIds.size} 个项目
            </span>
          )}
        </div>
      )}

      {isLoading && projects.length === 0 ? (
        <div className="text-center py-20">
          <Loader2 className="w-8 h-8 animate-spin mx-auto text-blue-500 mb-4" />
          <p className="text-gray-500">加载中...</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {projects.map(project => {
            const isSelected = selectedIds.has(project.id);
            return (
              <div key={project.id} className="relative group">
                <div className={`bg-white p-6 rounded-xl shadow-sm hover:shadow-md transition-all border ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-100 hover:border-blue-200'
                } relative`}>
                  {/* 选择复选框 */}
                  <div className="absolute top-4 left-4 z-10">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleSelect(project.id, e.target.checked);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="w-5 h-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                  </div>

                  <Link to={`/projects/${project.id}`} className="block">
                    <div className="flex items-start justify-between mb-4 pl-8">
                      <div className="p-3 bg-blue-50 rounded-lg text-blue-600">
                        <FileText className="w-6 h-6" />
                      </div>
                      <button
                        onClick={(e) => handleOpenActionDialog(e, project.id)}
                        className="p-2 text-gray-300 hover:text-gray-600 hover:bg-gray-100 rounded-full transition-all opacity-0 group-hover:opacity-100"
                        title="更多操作"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                    </div>
                    <h3 className="font-semibold text-gray-900 truncate mb-2" title={project.display_name || project.original_name}>
                      {project.display_name || project.original_name}
                    </h3>
                    <div className="flex items-center justify-between text-sm text-gray-500 mt-4">
                      <span className="flex items-center gap-1.5">
                        {getStatusIcon(project.status)}
                        <span className="font-medium">{getProjectStatusText(project.status, 'short')}</span>
                      </span>
                      <span>{new Date(project.created_at).toLocaleDateString()}</span>
                    </div>
                  </Link>
                </div>
              </div>
            );
          })}
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

      {/* 文件迁移对话框 */}
      {showMigrationDialog && (
        <FileMigrationDialog
          fileIds={migrationFileIds}
          onClose={() => {
            setShowMigrationDialog(false);
            setMigrationFileIds([]);
          }}
          onSuccess={handleMigrationSuccess}
        />
      )}

      {/* 项目操作对话框 */}
      {showActionDialog && actionDialogProjectId && (
        <ProjectActionDialog
          projectId={actionDialogProjectId}
          onClose={() => {
            setShowActionDialog(false);
            setActionDialogProjectId(null);
          }}
          onDelete={handleActionDialogDelete}
          onMigrationSuccess={handleActionDialogMigrationSuccess}
        />
      )}
    </div>
  );
};

const UploadIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
  </svg>
);

