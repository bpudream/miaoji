import React from 'react';
import { Loader2 } from 'lucide-react';
import type { Team, RosterMode } from '../../lib/api';
import { TRANSCRIBE_SCENARIO_OPTIONS } from './constants';

export interface TranscribeModalProps {
  open: boolean;
  projectDisplayName: string;
  scenario: string;
  onScenarioChange: (v: string) => void;
  teamHomeId: string;
  onTeamHomeChange: (v: string) => void;
  teamAwayId: string;
  onTeamAwayChange: (v: string) => void;
  rosterMode: RosterMode;
  onRosterModeChange: (v: RosterMode) => void;
  keywords: string;
  onKeywordsChange: (v: string) => void;
  homeSelected: string[];
  onHomeSelectedChange: (v: string[]) => void;
  awaySelected: string[];
  onAwaySelectedChange: (v: string[]) => void;
  teams: Team[];
  homeRosterNames: string[];
  awayRosterNames: string[];
  preview: string | null;
  previewLoading: boolean;
  previewTruncated: boolean;
  canConfirmTranscribe: boolean;
  isStarting: boolean;
  onClose: () => void;
  onConfirm: () => void;
  toggleSelected: (current: string[], name: string) => string[];
}

export const TranscribeModal: React.FC<TranscribeModalProps> = ({
  open,
  projectDisplayName,
  scenario,
  onScenarioChange,
  teamHomeId,
  onTeamHomeChange,
  teamAwayId,
  onTeamAwayChange,
  rosterMode,
  onRosterModeChange,
  keywords,
  onKeywordsChange,
  homeSelected,
  onHomeSelectedChange,
  awaySelected,
  onAwaySelectedChange,
  teams,
  homeRosterNames,
  awayRosterNames,
  preview,
  previewLoading,
  previewTruncated,
  canConfirmTranscribe,
  isStarting,
  onClose,
  onConfirm,
  toggleSelected,
}) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-lg max-h-[90vh] overflow-y-auto">
        <h3 className="text-base font-semibold text-gray-800 mb-3">转写选项</h3>
        <p className="text-sm text-gray-500 mb-3">选择场景模式以优化转写效果</p>

        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-1">文件名（将用于辅助识别）</label>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {projectDisplayName}
          </div>
        </div>

        <div className="mb-3">
          <label className="block text-sm font-medium text-gray-700 mb-2">场景模式</label>
          <select
            value={scenario}
            onChange={(e) => onScenarioChange(e.target.value)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {TRANSCRIBE_SCENARIO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {scenario === 'sports_football' && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">主队</label>
                <select
                  value={teamHomeId}
                  onChange={(e) => {
                    onTeamHomeChange(e.target.value);
                    onHomeSelectedChange([]);
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">无</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">客队</label>
                <select
                  value={teamAwayId}
                  onChange={(e) => {
                    onTeamAwayChange(e.target.value);
                    onAwaySelectedChange([]);
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">无</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {(teamHomeId || teamAwayId) && (
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700 mb-2">名单嵌入方式</label>
                <div className="flex flex-col gap-2">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="roster_mode"
                      checked={rosterMode === 'none'}
                      onChange={() => onRosterModeChange('none')}
                      className="text-blue-600"
                    />
                    <span className="text-sm">不嵌入名单（仅对阵信息 + 自定义关键词）</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="roster_mode"
                      checked={rosterMode === 'full'}
                      onChange={() => onRosterModeChange('full')}
                      className="text-blue-600"
                    />
                    <span className="text-sm">嵌入全部名单</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="roster_mode"
                      checked={rosterMode === 'starting'}
                      onChange={() => onRosterModeChange('starting')}
                      className="text-blue-600"
                    />
                    <span className="text-sm">嵌入首发名单（手动选择球员）</span>
                  </label>
                </div>
              </div>
            )}
            {rosterMode === 'starting' && (teamHomeId || teamAwayId) && (
              <div className="mb-3 space-y-3">
                {teamHomeId && (
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/60">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">主队首发</span>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>已选 {homeSelected.length} 人</span>
                        <button
                          type="button"
                          className="text-blue-600 hover:underline"
                          onClick={() => onHomeSelectedChange(homeRosterNames)}
                        >
                          全选
                        </button>
                        <button
                          type="button"
                          className="text-gray-500 hover:underline"
                          onClick={() => onHomeSelectedChange([])}
                        >
                          清空
                        </button>
                      </div>
                    </div>
                    {homeRosterNames.length === 0 ? (
                      <p className="text-xs text-gray-400">该球队暂无名单，请先在设置中维护球队名单</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {homeRosterNames.map((name) => (
                          <label key={name} className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={homeSelected.includes(name)}
                              onChange={() => onHomeSelectedChange(toggleSelected(homeSelected, name))}
                              className="text-blue-600"
                            />
                            <span>{name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {teamAwayId && (
                  <div className="border border-gray-200 rounded-lg p-3 bg-gray-50/60">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700">客队首发</span>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span>已选 {awaySelected.length} 人</span>
                        <button
                          type="button"
                          className="text-blue-600 hover:underline"
                          onClick={() => onAwaySelectedChange(awayRosterNames)}
                        >
                          全选
                        </button>
                        <button
                          type="button"
                          className="text-gray-500 hover:underline"
                          onClick={() => onAwaySelectedChange([])}
                        >
                          清空
                        </button>
                      </div>
                    </div>
                    {awayRosterNames.length === 0 ? (
                      <p className="text-xs text-gray-400">该球队暂无名单，请先在设置中维护球队名单</p>
                    ) : (
                      <div className="grid grid-cols-2 gap-2">
                        {awayRosterNames.map((name) => (
                          <label key={name} className="flex items-center gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              checked={awaySelected.includes(name)}
                              onChange={() => onAwaySelectedChange(toggleSelected(awaySelected, name))}
                              className="text-blue-600"
                            />
                            <span>{name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            {scenario === 'sports_football' ? '补充关键词/名单' : '自定义关键词'}
          </label>
          <textarea
            value={keywords}
            onChange={(e) => onKeywordsChange(e.target.value)}
            placeholder={
              scenario === 'sports_football'
                ? '可补充球员名、教练名等，多行或逗号分隔'
                : '多行或逗号分隔，用于提升专有名词识别'
            }
            rows={3}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">提示词预览</label>
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600 min-h-[60px]">
            {previewLoading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="w-4 h-4 animate-spin" />
                加载中…
              </span>
            ) : preview !== null && preview !== '' ? (
              <span className="whitespace-pre-wrap break-words">{preview}</span>
            ) : (
              <span className="text-gray-400">选择场景或填写关键词后将显示实际发送给转写引擎的提示词</span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-1">
            名单与关键词总长度有上限，过长时靠前的球员名会优先保留，以保证模型识别效果。
          </p>
          {previewTruncated && (
            <p className="text-xs text-amber-600 mt-1">
              提示词已超出长度上限，已自动截断。建议精简名单或减少关键词。
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          {!canConfirmTranscribe && (
            <p className="text-xs text-gray-400">当前状态不可转写，请等待任务完成或失败后重试</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              disabled={isStarting}
            >
              取消
            </button>
            <button
              onClick={onConfirm}
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
              disabled={isStarting || !canConfirmTranscribe}
            >
              {isStarting ? '启动中...' : '开始转写'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
