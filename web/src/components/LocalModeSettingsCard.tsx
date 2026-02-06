import { useEffect, useState } from 'react';
import { Box } from 'lucide-react';
import { getLocalModeSettings, updateLocalModeSettings, type LocalModeSettings } from '../lib/api';

export const LocalModeSettingsCard = () => {
  const [localModeSettings, setLocalModeSettings] = useState<LocalModeSettings | null>(null);
  const [localModeEnabled, setLocalModeEnabled] = useState(false);
  const [allowedPathsInput, setAllowedPathsInput] = useState('');
  const [localModeSaving, setLocalModeSaving] = useState(false);
  const [localModeError, setLocalModeError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      try {
        const localSettings = await getLocalModeSettings();
        if (!mounted) return;
        setLocalModeSettings(localSettings);
        setLocalModeEnabled(localSettings.localMode);
        setAllowedPathsInput(localSettings.allowedBasePaths.join('\n'));
      } catch (error) {
        if (!mounted) return;
        setLocalModeError('加载本地模式设置失败');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    load();
    return () => {
      mounted = false;
    };
  }, []);

  const handleSaveLocalMode = async () => {
    if (!localModeSettings) return;
    setLocalModeSaving(true);
    setLocalModeError(null);
    try {
      const payload: { localMode?: boolean; allowedBasePaths?: string[] } = {};
      if (localModeSettings.localModeSource !== 'env') {
        payload.localMode = localModeEnabled;
      }
      if (localModeSettings.allowedBasePathsSource !== 'env') {
        payload.allowedBasePaths = allowedPathsInput
          .split('\n')
          .map(line => line.trim())
          .filter(Boolean);
      }
      const updated = await updateLocalModeSettings(payload);
      setLocalModeSettings(updated);
      setLocalModeEnabled(updated.localMode);
      setAllowedPathsInput(updated.allowedBasePaths.join('\n'));
    } catch (error: any) {
      setLocalModeError(error.response?.data?.error || '保存失败，请重试');
    } finally {
      setLocalModeSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 md:p-6 border-b border-gray-100 flex items-center gap-3">
        <div className="p-2 bg-amber-50 rounded-lg">
          <Box className="w-5 h-5 md:w-6 md:h-6 text-amber-600" />
        </div>
        <div>
          <h3 className="text-base md:text-lg font-medium text-gray-900">本地模式</h3>
          <p className="text-xs md:text-sm text-gray-500">启用本地路径添加与路径白名单限制</p>
        </div>
      </div>
      <div className="p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-700">启用本地路径添加</p>
            <p className="text-xs text-gray-400">启用后可在上传页直接填写本机路径</p>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-gray-600">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              checked={localModeEnabled}
              onChange={(e) => setLocalModeEnabled(e.target.checked)}
              disabled={localModeSettings?.localModeSource === 'env' || localModeSaving || loading}
            />
            <span>{localModeEnabled ? '已启用' : '未启用'}</span>
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">允许的根路径（每行一个）</label>
          <textarea
            rows={3}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="例如：D:\\Videos\n/mnt/storage"
            value={allowedPathsInput}
            onChange={(e) => setAllowedPathsInput(e.target.value)}
            disabled={localModeSettings?.allowedBasePathsSource === 'env' || localModeSaving || loading}
          />
          <p className="text-xs text-gray-400 mt-2">留空表示不限制路径（仅限本机访问场景）</p>
        </div>

        {(localModeSettings?.localModeSource === 'env' || localModeSettings?.allowedBasePathsSource === 'env') && (
          <div className="text-xs text-amber-600 bg-amber-50 border border-amber-100 rounded-lg p-2">
            当前设置由环境变量控制，UI 仅显示状态。如需修改，请调整环境变量并重启后端。
          </div>
        )}

        {localModeError && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-2">
            {localModeError}
          </div>
        )}

        <div className="flex justify-end">
          <button
            onClick={handleSaveLocalMode}
            disabled={localModeSaving || loading || !localModeSettings}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-500"
          >
            {localModeSaving ? '保存中...' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  );
};
