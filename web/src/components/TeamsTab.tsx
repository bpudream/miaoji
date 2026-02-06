import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { getTeams, createTeam, updateTeam, deleteTeam, type Team } from '../lib/api';

/** 将名单文本解析为名字数组：按换行、英文逗号或中文逗号分隔，去空、去首尾空格 */
function parseRosterNames(roster: string | null): string[] {
  if (!roster || !roster.trim()) return [];
  return roster
    .split(/[\r\n,，]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export const TeamsTab = () => {
  const [list, setList] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formName, setFormName] = useState('');
  const [formRoster, setFormRoster] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadList = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getTeams();
      setList(data);
    } catch (e: any) {
      setError(e?.response?.data?.error || '加载球队列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadList();
  }, []);

  const openCreate = () => {
    setEditingId(null);
    setIsCreating(true);
    setFormName('');
    setFormRoster('');
  };

  const openEdit = (t: Team) => {
    setIsCreating(false);
    setEditingId(t.id);
    setFormName(t.name);
    setFormRoster(t.roster_text ?? '');
  };

  const closeForm = () => {
    setEditingId(null);
    setIsCreating(false);
    setFormName('');
    setFormRoster('');
  };

  const handleSave = async () => {
    const name = formName.trim();
    if (!name) {
      setError('请输入球队名称');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (isCreating) {
        await createTeam({
          name,
          roster_text: formRoster.trim() || null
        });
      } else if (editingId) {
        await updateTeam(editingId, {
          name,
          roster_text: formRoster.trim() || null
        });
      }
      await loadList();
      closeForm();
    } catch (e: any) {
      setError(e?.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除该球队？')) return;
    setError(null);
    try {
      await deleteTeam(id);
      if (editingId === id) closeForm();
      await loadList();
    } catch (e: any) {
      setError(e?.response?.data?.error || '删除失败');
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-gray-800">球队名单</h3>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            新建球队
          </button>
        </div>
        <p className="text-sm text-gray-500 mb-4">
          在此维护球队名称与球员/术语名单，转写时选择「足球」场景即可在下拉框中选择主队、客队，名单将自动用于提升专有名词识别准确率。
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 text-gray-500 py-8">
            <Loader2 className="w-5 h-5 animate-spin" />
            加载中…
          </div>
        ) : list.length === 0 && !isCreating ? (
          <div className="py-8 text-center text-gray-500 text-sm">
            暂无球队，点击「新建球队」添加
          </div>
        ) : (
          <ul className="space-y-2">
            {list.map((t) => {
              const names = parseRosterNames(t.roster_text);
              const count = names.length;
              const isExpanded = expandedId === t.id;

              return (
                <li
                  key={t.id}
                  className="rounded-lg border border-gray-200 bg-gray-50/50 overflow-hidden"
                >
                  <div className="flex items-center gap-2 p-3">
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : t.id)}
                      className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded"
                      title={isExpanded ? '收起' : '展开'}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-4 h-4" />
                      ) : (
                        <ChevronRight className="w-4 h-4" />
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      <span className="font-medium text-gray-800">{t.name}</span>
                      <span className="text-sm text-gray-500 ml-2">
                        共 {count} 名球员
                      </span>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => openEdit(t)}
                        className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg"
                        title="编辑"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(t.id)}
                        className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg"
                        title="删除"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-gray-200 bg-white/80 px-3 py-2 pl-10">
                      {names.length === 0 ? (
                        <p className="text-sm text-gray-400">暂无名单</p>
                      ) : (
                        <ul className="text-sm text-gray-700 space-y-0.5">
                          {names.map((name, i) => (
                            <li key={i} className="leading-relaxed">{name}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {(isCreating || editingId) && (
          <div className="mt-6 pt-6 border-t border-gray-200">
            <h4 className="text-sm font-medium text-gray-700 mb-3">
              {isCreating ? '新建球队' : '编辑球队'}
            </h4>
            <div className="space-y-3 max-w-lg">
              <label className="block text-sm font-medium text-gray-700">球队名称</label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="如：Liverpool"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">名单/术语</label>
                <p className="text-xs text-gray-500 mb-2">
                  支持每行一个名字，或使用英文逗号分隔（如 Salah, Nunez, Szoboszlai）；展示时按一行一个显示。
                </p>
                <textarea
                  value={formRoster}
                  onChange={(e) => setFormRoster(e.target.value)}
                  placeholder={'每行一个：\nSalah\nNunez\nSzoboszlai\n或英文逗号分隔：Salah, Nunez, Szoboszlai'}
                  rows={12}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 font-mono"
                />
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isCreating ? '创建' : '保存'}
                </button>
                <button
                  type="button"
                  onClick={closeForm}
                  className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
