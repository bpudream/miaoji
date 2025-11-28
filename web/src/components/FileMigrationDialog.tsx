import React, { useState, useEffect } from 'react';
import {
  getStoragePaths,
  migrateFiles,
  StoragePath
} from '../lib/api';
import {
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
  HardDrive
} from 'lucide-react';

interface FileMigrationDialogProps {
  fileIds: number[];
  onClose: () => void;
  onSuccess?: () => void;
}

interface MigrationInfo {
  currentPathId: number | null;
  currentPath: {
    id: number;
    name: string;
    path: string;
  } | null;
  isProjectStructure?: boolean; // 是否为项目目录结构（新结构）
}

export const FileMigrationDialog: React.FC<FileMigrationDialogProps> = ({
  fileIds,
  onClose,
  onSuccess
}) => {
  const [paths, setPaths] = useState<StoragePath[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPathId, setSelectedPathId] = useState<number | null>(null);
  const [deleteSource, setDeleteSource] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [progress, setProgress] = useState<{
    current: number;
    total: number;
    results: Array<{ fileId: number; success: boolean; message: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [migrationInfo, setMigrationInfo] = useState<MigrationInfo | null>(null);

  useEffect(() => {
    loadPaths();
    if (fileIds.length === 1) {
      loadMigrationInfo(fileIds[0]);
    }
  }, [fileIds]);

  const loadPaths = async () => {
    setLoading(true);
    try {
      const data = await getStoragePaths();
      const enabledPaths = data.filter(p => p.enabled);
      setPaths(enabledPaths);
      if (enabledPaths.length > 0) {
        setSelectedPathId(enabledPaths[0].id);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '加载存储路径失败');
    } finally {
      setLoading(false);
    }
  };

  const loadMigrationInfo = async (fileId: number) => {
    try {
      const apiUrl = import.meta.env.VITE_API_URL || (window.location.origin + '/api');
      const response = await fetch(`${apiUrl}/projects/${fileId}/migration-info`);
      if (response.ok) {
        const data = await response.json();
        if (data.status === 'success') {
          setMigrationInfo({
            currentPathId: data.currentPathId ?? null,
            currentPath: data.currentPath ?? null,
            isProjectStructure: data.isProjectStructure ?? false
          });
        }
      } else {
        // API调用失败，设置为null，不影响迁移功能
        console.warn('Failed to load migration info, status:', response.status);
        setMigrationInfo(null);
      }
    } catch (err) {
      // 网络错误或其他错误，设置为null，不影响迁移功能
      console.warn('Failed to load migration info:', err);
      setMigrationInfo(null);
    }
  };

  // 检查目标路径是否与当前路径相同
  // 注意：即使存储路径ID相同，如果文件结构不同（扁平 vs 项目目录），也应该允许迁移
  // 所以这里只检查存储路径ID是否相同，实际的文件路径比较由后端完成
  const isSameStoragePath = migrationInfo?.currentPathId !== null &&
                             migrationInfo?.currentPathId !== undefined &&
                             selectedPathId !== null &&
                             selectedPathId === migrationInfo.currentPathId;

  // 如果存储路径相同，但文件不是项目目录结构，说明需要迁移以转换结构
  const needsStructureMigration = isSameStoragePath && !migrationInfo?.isProjectStructure;

  // 只有当存储路径相同且文件已经是项目目录结构时，才认为无需迁移
  const isSamePath = isSameStoragePath && migrationInfo?.isProjectStructure;

  const handleMigrate = async () => {
    if (!selectedPathId) {
      setError('请选择目标存储路径');
      return;
    }

    setMigrating(true);
    setError(null);
    setProgress({ current: 0, total: fileIds.length, results: [] });

    try {
      const result = await migrateFiles({
        file_ids: fileIds,
        target_path_id: selectedPathId,
        delete_source: deleteSource
      });

      setProgress({
        current: result.total,
        total: result.total,
        results: result.results
      });

      if (result.failed === 0) {
        // 全部成功
        setTimeout(() => {
          onSuccess?.();
          onClose();
        }, 1500);
      } else {
        setError(`迁移完成：成功 ${result.success} 个，失败 ${result.failed} 个`);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '迁移失败');
    } finally {
      setMigrating(false);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-800 flex items-center gap-2">
            <HardDrive className="w-5 h-5" />
            迁移文件
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              <div>
                <p className="text-sm text-gray-600 mb-4">
                  将迁移 <span className="font-semibold">{fileIds.length}</span> 个文件
                </p>

                {/* 当前路径信息 */}
                {migrationInfo?.currentPath && (
                  <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="text-xs text-blue-600 font-medium mb-1">当前存储路径</div>
                    <div className="text-sm text-blue-800 font-semibold">{migrationInfo.currentPath.name}</div>
                    <div className="text-xs text-blue-600 font-mono mt-1">{migrationInfo.currentPath.path}</div>
                  </div>
                )}

                {/* 无法检测当前路径的提示（兼容旧数据） */}
                {migrationInfo === null && fileIds.length === 1 && (
                  <div className="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                    <div className="text-xs text-gray-600 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      无法检测当前存储路径（可能是旧数据），迁移功能仍可正常使用
                    </div>
                  </div>
                )}

                {/* 路径相同警告 */}
                {isSamePath && (
                  <div className="mb-4 p-4 bg-amber-50 border-2 border-amber-400 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="font-semibold text-amber-800 mb-1">目标路径与当前路径完全相同</div>
                      <div className="text-sm text-amber-700">
                        您选择的目标路径与文件当前所在路径完全相同，无需进行迁移操作。
                      </div>
                    </div>
                  </div>
                )}

                {/* 结构转换提示 */}
                {needsStructureMigration && (
                  <div className="mb-4 p-4 bg-blue-50 border-2 border-blue-400 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <div className="font-semibold text-blue-800 mb-1">将转换文件结构</div>
                      <div className="text-sm text-blue-700">
                        文件当前使用扁平结构，迁移后将转换为项目目录结构（{fileIds.length === 1 ? '项目ID目录' : '各项目独立目录'}），这是推荐的结构。
                      </div>
                    </div>
                  </div>
                )}

                <label className="block text-sm font-medium text-gray-700 mb-2">
                  选择目标存储路径
                </label>
                <div className="space-y-2">
                  {paths.length === 0 ? (
                    <p className="text-sm text-gray-400">没有可用的存储路径</p>
                  ) : (
                    paths.map((path) => (
                      <label
                        key={path.id}
                        className={`flex items-start gap-3 p-3 border rounded-lg cursor-pointer transition-colors ${
                          selectedPathId === path.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <input
                          type="radio"
                          name="targetPath"
                          value={path.id}
                          checked={selectedPathId === path.id}
                          onChange={() => setSelectedPathId(path.id)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <div className="font-medium text-gray-800">{path.name}</div>
                          <div className="text-xs text-gray-500 font-mono mt-1">{path.path}</div>
                          {path.info && (
                            <div className="mt-2 text-xs text-gray-600">
                              <div className="flex items-center justify-between mb-1">
                                <span>可用空间</span>
                                <span className="font-semibold">{formatBytes(path.info.free)}</span>
                              </div>
                              <div className="w-full bg-gray-200 rounded-full h-1.5">
                                <div
                                  className={`h-1.5 rounded-full ${
                                    path.info.usagePercent >= 90
                                      ? 'bg-red-500'
                                      : path.info.usagePercent >= 70
                                      ? 'bg-yellow-500'
                                      : 'bg-green-500'
                                  }`}
                                  style={{ width: `${path.info.usagePercent}%` }}
                                />
                              </div>
                            </div>
                          )}
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="deleteSource"
                  checked={deleteSource}
                  onChange={(e) => setDeleteSource(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="deleteSource" className="text-sm text-gray-700 cursor-pointer">
                  迁移后删除源文件（节省空间）
                </label>
              </div>

              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}

              {progress && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">迁移进度</span>
                    <span className="font-semibold">
                      {progress.current} / {progress.total}
                    </span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all"
                      style={{ width: `${(progress.current / progress.total) * 100}%` }}
                    />
                  </div>
                  {progress.results.length > 0 && (
                    <div className="mt-3 space-y-1 max-h-40 overflow-y-auto">
                      {progress.results.map((result, idx) => (
                        <div
                          key={idx}
                          className={`flex items-center gap-2 text-xs p-2 rounded ${
                            result.success
                              ? 'bg-green-50 text-green-700'
                              : 'bg-red-50 text-red-700'
                          }`}
                        >
                          {result.success ? (
                            <CheckCircle2 className="w-3 h-3" />
                          ) : (
                            <AlertCircle className="w-3 h-3" />
                          )}
                          <span>文件 #{result.fileId}: {result.message}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3 pt-4 border-t border-gray-200">
                <button
                  onClick={handleMigrate}
                  disabled={migrating || !selectedPathId || paths.length === 0 || isSamePath}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                >
                  {migrating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      迁移中...
                    </>
                  ) : isSamePath ? (
                    '无需迁移'
                  ) : (
                    '开始迁移'
                  )}
                </button>
                <button
                  onClick={onClose}
                  disabled={migrating}
                  className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 disabled:bg-gray-100 disabled:cursor-not-allowed transition-colors"
                >
                  取消
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

