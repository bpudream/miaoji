import React, { useState, useEffect } from 'react';
import {
  getStoragePaths,
  addStoragePath,
  updateStoragePath,
  deleteStoragePath,
  StoragePath
} from '../lib/api';
import {
  Plus,
  Edit,
  Trash2,
  HardDrive,
  AlertCircle,
  CheckCircle2,
  X,
  Save,
  Loader2
} from 'lucide-react';

interface StoragePathsManagerProps {
  className?: string;
}

export const StoragePathsManager: React.FC<StoragePathsManagerProps> = ({ className }) => {
  const [paths, setPaths] = useState<StoragePath[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    path: '',
    priority: 0,
    max_size_gb: null as number | null,
    enabled: true
  });

  useEffect(() => {
    loadPaths();
  }, []);

  const loadPaths = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getStoragePaths();
      setPaths(data);
    } catch (err: any) {
      setError(err.response?.data?.error || '加载存储路径失败');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    try {
      await addStoragePath(formData);
      setShowAddForm(false);
      setFormData({ name: '', path: '', priority: 0, max_size_gb: null, enabled: true });
      await loadPaths();
    } catch (err: any) {
      setError(err.response?.data?.error || '添加存储路径失败');
    }
  };

  const handleUpdate = async (id: number) => {
    try {
      await updateStoragePath(id, formData);
      setEditingId(null);
      setFormData({ name: '', path: '', priority: 0, max_size_gb: null, enabled: true });
      await loadPaths();
    } catch (err: any) {
      setError(err.response?.data?.error || '更新存储路径失败');
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('确定要删除这个存储路径吗？如果该路径下有文件，请先迁移文件。')) {
      return;
    }
    try {
      await deleteStoragePath(id);
      await loadPaths();
    } catch (err: any) {
      setError(err.response?.data?.error || '删除存储路径失败');
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const getUsageColor = (percent: number): string => {
    if (percent >= 90) return 'bg-red-500';
    if (percent >= 70) return 'bg-yellow-500';
    return 'bg-green-500';
  };

  if (loading) {
    return (
      <div className={`flex items-center justify-center p-8 ${className}`}>
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
          <HardDrive className="w-5 h-5" />
          存储路径管理
        </h3>
        <button
          onClick={() => {
            setShowAddForm(true);
            setFormData({ name: '', path: '', priority: 0, max_size_gb: null, enabled: true });
          }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          添加路径
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4" />
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-auto"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 添加表单 */}
      {showAddForm && (
        <div className="mb-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h4 className="font-medium text-gray-800 mb-3">添加存储路径</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">路径名称</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="例如：D盘、外置硬盘"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">存储路径（绝对路径）</label>
              <input
                type="text"
                value={formData.path}
                onChange={(e) => setFormData({ ...formData, path: e.target.value })}
                placeholder="例如：D:\uploads 或 /mnt/storage"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">优先级</label>
                <input
                  type="number"
                  value={formData.priority}
                  onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">最大容量限制（GB，可选）</label>
                <input
                  type="number"
                  value={formData.max_size_gb || ''}
                  onChange={(e) => setFormData({ ...formData, max_size_gb: e.target.value ? parseFloat(e.target.value) : null })}
                  placeholder="留空表示无限制"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleAdd}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
              >
                <Save className="w-4 h-4" />
                保存
              </button>
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setFormData({ name: '', path: '', priority: 0, max_size_gb: null, enabled: true });
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 路径列表 */}
      <div className="space-y-3">
        {paths.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            暂无存储路径，请添加一个
          </div>
        ) : (
          paths.map((path) => (
            <div
              key={path.id}
              className="p-4 bg-white border border-gray-200 rounded-lg hover:shadow-md transition-shadow"
            >
              {editingId === path.id ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">路径名称</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">优先级</label>
                      <input
                        type="number"
                        value={formData.priority}
                        onChange={(e) => setFormData({ ...formData, priority: parseInt(e.target.value) || 0 })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">最大容量（GB）</label>
                      <input
                        type="number"
                        value={formData.max_size_gb || ''}
                        onChange={(e) => setFormData({ ...formData, max_size_gb: e.target.value ? parseFloat(e.target.value) : null })}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      />
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={formData.enabled !== false}
                        onChange={(e) => setFormData({ ...formData, enabled: e.target.checked })}
                        className="rounded"
                      />
                      启用
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleUpdate(path.id)}
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
                    >
                      <Save className="w-4 h-4" />
                      保存
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(null);
                        setFormData({ name: '', path: '', priority: 0, max_size_gb: null, enabled: true });
                      }}
                      className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h4 className="font-medium text-gray-800">{path.name}</h4>
                        {path.enabled ? (
                          <span className="flex items-center gap-1 text-xs text-green-600">
                            <CheckCircle2 className="w-3 h-3" />
                            启用
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-gray-400">
                            <X className="w-3 h-3" />
                            禁用
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-gray-600 font-mono mb-2">{path.path}</p>
                      {path.info && (
                        <div className="mt-3">
                          <div className="flex items-center justify-between text-xs text-gray-600 mb-1">
                            <span>磁盘使用情况</span>
                            <span>{path.info.usagePercent.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-gray-200 rounded-full h-2 mb-1">
                            <div
                              className={`h-2 rounded-full ${getUsageColor(path.info.usagePercent)}`}
                              style={{ width: `${path.info.usagePercent}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs text-gray-500">
                            <span>已用: {formatBytes(path.info.used)}</span>
                            <span>可用: {formatBytes(path.info.free)}</span>
                            <span>总计: {formatBytes(path.info.total)}</span>
                          </div>
                        </div>
                      )}
                      {!path.info && (
                        <p className="text-xs text-gray-400">无法获取磁盘信息</p>
                      )}
                      <div className="mt-2 flex items-center gap-4 text-xs text-gray-500">
                        <span>优先级: {path.priority}</span>
                        {path.max_size_gb && <span>最大容量: {path.max_size_gb} GB</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-4">
                      <button
                        onClick={() => {
                          setEditingId(path.id);
                          setFormData({
                            name: path.name,
                            path: path.path,
                            priority: path.priority,
                            max_size_gb: path.max_size_gb,
                            enabled: path.enabled
                          });
                        }}
                        className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                        title="编辑"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(path.id)}
                        className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

