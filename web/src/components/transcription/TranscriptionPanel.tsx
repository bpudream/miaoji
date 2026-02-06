import React, { useState, useRef, useEffect, useCallback } from 'react';
import clsx from 'clsx';
import {
  getTranslation,
  requestTranslation,
  exportTranscription,
  getTeams,
  getTranscribePreview,
  startTranscription,
  type TranslationResponse,
  type ExportFormat,
  type Team,
  type RosterMode,
} from '../../lib/api';
import { getProjectStatusText } from '../../lib/status';
import { FileText, Copy, Loader2, Download, AlertCircle, Anchor, MoreVertical } from 'lucide-react';
import { useAppStore } from '../../stores/useAppStore';
import { parseRosterNames } from './utils';
import { TranscriptionResult } from './TranscriptionResult';
import { TranslationView } from './TranslationView';
import { TranslateModal } from './TranslateModal';
import { TranscribeModal } from './TranscribeModal';
import { EXPORT_FORMAT_OPTIONS } from './constants';
import type { TranscriptionPanelProps } from './types';
import type { ViewMode } from './types';

export const TranscriptionPanel: React.FC<TranscriptionPanelProps> = ({
  project,
  className,
  playerRef,
  currentPlayTime,
}) => {
  const loadProject = useAppStore((state) => state.loadProject);

  const [isEditing, setIsEditing] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('original');
  const [showTranslateModal, setShowTranslateModal] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState('zh');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translationError, setTranslationError] = useState<string | null>(null);
  const [translationData, setTranslationData] = useState<TranslationResponse | null>(null);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [exportingFormat, setExportingFormat] = useState<ExportFormat | null>(null);
  const [stats, setStats] = useState<{
    segmentCount: number;
    duration: number | null;
    lastSaved: Date | null;
  } | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  const [showTranscribeModal, setShowTranscribeModal] = useState(false);
  const [transcribeScenario, setTranscribeScenario] = useState<string>('default');
  const [teams, setTeams] = useState<Team[]>([]);
  const [transcribeTeamHomeId, setTranscribeTeamHomeId] = useState<string>('');
  const [transcribeTeamAwayId, setTranscribeTeamAwayId] = useState<string>('');
  const [transcribeRosterMode, setTranscribeRosterMode] = useState<RosterMode>('none');
  const [transcribeKeywords, setTranscribeKeywords] = useState<string>('');
  const [transcribeHomeSelected, setTranscribeHomeSelected] = useState<string[]>([]);
  const [transcribeAwaySelected, setTranscribeAwaySelected] = useState<string[]>([]);
  const [transcribePreview, setTranscribePreview] = useState<string | null>(null);
  const [transcribePreviewLoading, setTranscribePreviewLoading] = useState(false);
  const [transcribePreviewTruncated, setTranscribePreviewTruncated] = useState(false);

  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (!actionsMenuRef.current) return;
      if (!actionsMenuRef.current.contains(event.target as Node)) {
        setExportMenuOpen(false);
        setActionsMenuOpen(false);
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    };
  }, []);

  const startPollingTranslation = useCallback(
    (lang: string) => {
      let attempts = 0;
      const maxAttempts = 30;
      const intervalMs = 2500;
      const poll = async () => {
        attempts += 1;
        try {
          const result = await getTranslation(project.id, lang);
          setTranslationData(result);
          setIsTranslating(false);
          setTranslationError(null);
          return;
        } catch (err: any) {
          const status = err?.response?.status;
          if (status === 404) {
            if (attempts >= maxAttempts) {
              setIsTranslating(false);
              setTranslationError('处理超时，请稍后刷新或重试');
              return;
            }
          } else {
            setIsTranslating(false);
            setTranslationError(
              err?.response?.data?.error || '翻译失败，请稍后重试'
            );
            return;
          }
        }
        pollTimerRef.current = window.setTimeout(poll, intervalMs);
      };
      pollTimerRef.current = window.setTimeout(poll, 200);
    },
    [project.id]
  );

  useEffect(() => {
    if (viewMode === 'translated' || viewMode === 'bilingual') {
      if (!translationData && !isTranslating) {
        startPollingTranslation(targetLanguage);
      }
    }
  }, [viewMode, targetLanguage, translationData, isTranslating, startPollingTranslation]);

  const handleExport = async (format: ExportFormat) => {
    if (!project) return;
    setExportingFormat(format);
    try {
      const lang = targetLanguage || 'zh';
      const { blob, filename } = await exportTranscription(
        project.id,
        format,
        lang
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const fallbackName = `${project.original_name || project.filename || 'transcription'}.${format}`;
      link.download = filename || fallbackName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error(err);
      alert('导出失败，请稍后再试');
    } finally {
      setExportingFormat(null);
      setExportMenuOpen(false);
      setActionsMenuOpen(false);
    }
  };

  const handleEditToggle = () => setIsEditing(!isEditing);

  const handleTranslate = async () => {
    if (!project?.id) return;
    setIsTranslating(true);
    setTranslationError(null);
    setTranslationData(null);
    try {
      await requestTranslation(project.id, targetLanguage);
      startPollingTranslation(targetLanguage);
      setShowTranslateModal(false);
    } catch (err: any) {
      setIsTranslating(false);
      setTranslationError(err?.response?.data?.error || '提交翻译任务失败');
    }
  };

  const handleTriggerRefine = () => {
    alert('润色流程开发中，待 US-6.4 集成后可调用 Ollama 润色稿件');
  };

  const handleOpenTranscribeModal = () => {
    setTranscribeScenario(
      project.scenario &&
        ['default', 'education', 'sports_football'].includes(project.scenario)
        ? project.scenario
        : 'default'
    );
    setTranscribeTeamHomeId('');
    setTranscribeTeamAwayId('');
    setTranscribeRosterMode('none');
    setTranscribeKeywords('');
    setTranscribeHomeSelected([]);
    setTranscribeAwaySelected([]);
    setTranscribePreview(null);
    setTranscribePreviewTruncated(false);
    setShowTranscribeModal(true);
    getTeams().then(setTeams).catch(() => setTeams([]));
  };

  useEffect(() => {
    if (!showTranscribeModal || !project?.id) return;
    const t = setTimeout(() => {
      setTranscribePreviewLoading(true);
      const meta: {
        team_home_id?: string;
        team_away_id?: string;
        keywords?: string;
        roster_mode?: RosterMode;
        selected_players?: string[];
      } = {};
      if (transcribeTeamHomeId) meta.team_home_id = transcribeTeamHomeId;
      if (transcribeTeamAwayId) meta.team_away_id = transcribeTeamAwayId;
      if (
        transcribeScenario === 'sports_football' &&
        (transcribeTeamHomeId || transcribeTeamAwayId)
      ) {
        meta.roster_mode = transcribeRosterMode;
        if (transcribeRosterMode === 'starting') {
          const selected = [
            ...transcribeHomeSelected,
            ...transcribeAwaySelected,
          ];
          if (selected.length > 0) meta.selected_players = selected;
        }
      }
      if (transcribeKeywords.trim()) meta.keywords = transcribeKeywords.trim();
      getTranscribePreview(project.id, {
        scenario: transcribeScenario,
        meta: Object.keys(meta).length > 0 ? meta : undefined,
      })
        .then((r) => {
          setTranscribePreview(r.prompt || '');
          setTranscribePreviewTruncated(Boolean(r.truncated));
        })
        .catch(() => {
          setTranscribePreview(null);
          setTranscribePreviewTruncated(false);
        })
        .finally(() => setTranscribePreviewLoading(false));
    }, 400);
    return () => clearTimeout(t);
  }, [
    showTranscribeModal,
    project?.id,
    transcribeScenario,
    transcribeTeamHomeId,
    transcribeTeamAwayId,
    transcribeRosterMode,
    transcribeHomeSelected,
    transcribeAwaySelected,
    transcribeKeywords,
  ]);

  const handleConfirmTranscribe = async () => {
    if (!project?.id || !canConfirmTranscribe) return;
    setIsStarting(true);
    try {
      const meta: {
        team_home_id?: string;
        team_away_id?: string;
        keywords?: string;
        roster_mode?: RosterMode;
        selected_players?: string[];
      } = {};
      if (transcribeTeamHomeId) meta.team_home_id = transcribeTeamHomeId;
      if (transcribeTeamAwayId) meta.team_away_id = transcribeTeamAwayId;
      if (
        transcribeScenario === 'sports_football' &&
        (transcribeTeamHomeId || transcribeTeamAwayId)
      ) {
        meta.roster_mode = transcribeRosterMode;
        if (transcribeRosterMode === 'starting') {
          const selected = [
            ...transcribeHomeSelected,
            ...transcribeAwaySelected,
          ];
          if (selected.length > 0) meta.selected_players = selected;
        }
      }
      if (transcribeKeywords.trim()) meta.keywords = transcribeKeywords.trim();
      await startTranscription(project.id, {
        scenario: transcribeScenario,
        meta: Object.keys(meta).length > 0 ? meta : undefined,
      });
      setShowTranscribeModal(false);
      await loadProject(project.id, true);
    } catch (err: any) {
      console.error(err);
      alert(err?.response?.data?.error || '启动转写失败，请稍后再试');
    } finally {
      setIsStarting(false);
    }
  };

  const toggleSelected = (current: string[], name: string) =>
    current.includes(name) ? current.filter((n) => n !== name) : [...current, name];

  const durationLabel = stats?.duration
    ? `${(stats.duration / 60).toFixed(1)} min`
    : '未知时长';
  const segmentStat = stats?.segmentCount ? `${stats.segmentCount} 段` : '';
  const translationReady = Boolean(translationData);
  const canStartTranscribe = project.status === 'ready_to_transcribe';
  const canConfirmTranscribe = ['ready_to_transcribe', 'completed', 'error'].includes(
    project.status
  );

  const homeTeam = teams.find((t) => t.id === transcribeTeamHomeId);
  const awayTeam = teams.find((t) => t.id === transcribeTeamAwayId);
  const homeRosterNames = parseRosterNames(homeTeam?.roster_text);
  const awayRosterNames = parseRosterNames(awayTeam?.roster_text);

  return (
    <div
      className={clsx(
        'flex h-full flex-col rounded-xl border border-gray-100 bg-white shadow-sm overflow-hidden',
        className
      )}
    >
      <div className="flex-shrink-0 flex items-center justify-between px-6 pt-6 pb-4 border-b">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-gray-800">
            <FileText className="w-5 h-5 text-blue-500" />
            转写内容
          </h2>
          {stats && (
            <>
              <span className="text-xs text-gray-500 font-medium bg-gray-50 px-2.5 py-1 rounded-full border border-gray-200">
                {segmentStat} · {durationLabel}
              </span>
              {stats.lastSaved && (
                <span className="text-xs text-gray-400">
                  最后更新 {stats.lastSaved.toLocaleTimeString()}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canStartTranscribe && (
            <button
              onClick={handleOpenTranscribeModal}
              className="inline-flex items-center gap-1.5 rounded-full bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              disabled={isStarting}
              title="开始转写"
            >
              {isStarting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Anchor className="w-4 h-4" />
              )}
              {isStarting ? '启动中...' : '开始转写'}
            </button>
          )}
          {project.transcription && (
            <button
              className="text-gray-400 hover:text-blue-600 transition-colors p-1 rounded hover:bg-blue-50"
              onClick={() => {
                const content = project.transcription?.content;
                const text =
                  typeof content === 'object'
                    ? (content.text || JSON.stringify(content))
                    : content;
                navigator.clipboard.writeText(text || '');
              }}
              title="复制全文"
            >
              <Copy className="w-4 h-4" />
            </button>
          )}
          {project.status === 'completed' && (
            <>
              <div className="flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-1.5 py-1 text-xs">
                {(['original', 'translated', 'bilingual'] as ViewMode[]).map(
                  (m) => (
                    <button
                      key={m}
                      onClick={() => setViewMode(m)}
                      className={clsx(
                        'px-2 py-1 rounded-full transition-colors',
                        viewMode === m
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      )}
                      title={
                        m === 'original'
                          ? '仅原文'
                          : m === 'translated'
                            ? '仅译文'
                            : '双语对照'
                      }
                    >
                      {m === 'original' && '原文'}
                      {m === 'translated' && '译文'}
                      {m === 'bilingual' && '双语'}
                    </button>
                  )
                )}
              </div>
              <button
                onClick={() => setShowTranslateModal(true)}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-indigo-400 hover:text-indigo-600 transition-colors disabled:opacity-50"
                title="AI 翻译"
                disabled={isTranslating}
              >
                <span className="text-base">🌐</span>
                {isTranslating ? '翻译中...' : 'AI 翻译'}
              </button>
              <div className="relative" ref={actionsMenuRef}>
                <button
                  onClick={() => {
                    setActionsMenuOpen((prev) => {
                      const next = !prev;
                      if (!next) setExportMenuOpen(false);
                      return next;
                    });
                  }}
                  className="inline-flex items-center justify-center rounded-full border border-gray-300 p-2 text-gray-600 hover:border-blue-400 hover:text-blue-600 transition-colors"
                  title="更多操作"
                >
                  <MoreVertical className="w-4 h-4" />
                </button>
                {actionsMenuOpen && (
                  <div className="absolute right-0 mt-2 w-48 rounded-xl border border-gray-100 bg-white p-1 text-sm shadow-lg z-20">
                    <button
                      onClick={() => {
                        handleOpenTranscribeModal();
                        setActionsMenuOpen(false);
                        setExportMenuOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
                      title="重新转写"
                    >
                      <Anchor className="w-4 h-4 text-blue-500" />
                      重新转写
                    </button>
                    <button
                      onClick={() => {
                        handleEditToggle();
                        setActionsMenuOpen(false);
                        setExportMenuOpen(false);
                      }}
                      className={clsx(
                        'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-gray-50',
                        viewMode !== 'original'
                          ? 'text-gray-400'
                          : 'text-gray-700'
                      )}
                      title={isEditing ? '编辑中' : '进入编辑'}
                      disabled={viewMode !== 'original'}
                    >
                      <FileText className="w-4 h-4 text-gray-500" />
                      编辑
                    </button>
                    <button
                      onClick={handleTriggerRefine}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-gray-400"
                      disabled
                      title="AI润色（即将推出）"
                    >
                      <span className="text-base">✨</span>
                      润色
                    </button>
                    <div className="border-t border-gray-100 my-1" />
                    <div className="relative">
                      <button
                        onClick={() => setExportMenuOpen(!exportMenuOpen)}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-gray-700 hover:bg-gray-50"
                        title="导出"
                      >
                        <span className="flex items-center gap-2">
                          <Download className="w-4 h-4 text-gray-500" />
                          导出
                        </span>
                        <span className="text-gray-400">▸</span>
                      </button>
                      {exportMenuOpen && (
                        <div className="mt-1 rounded-lg border border-gray-100 bg-white p-1 text-sm shadow-sm">
                          {EXPORT_FORMAT_OPTIONS.map((option) => (
                            <button
                              key={option.format}
                              onClick={() =>
                                handleExport(option.format as ExportFormat)
                              }
                              disabled={
                                exportingFormat === option.format ||
                                ((option.format === 'srt_translated' ||
                                  option.format === 'srt_bilingual') &&
                                  !translationReady)
                              }
                              className={clsx(
                                'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-gray-50',
                                exportingFormat === option.format
                                  ? 'text-gray-400'
                                  : 'text-gray-700',
                                (option.format === 'srt_translated' ||
                                  option.format === 'srt_bilingual') &&
                                  !translationReady &&
                                  'text-gray-400'
                              )}
                            >
                              <span>{option.label}</span>
                              {exportingFormat === option.format && (
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-500" />
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden px-6">
        {project.status === 'completed' ? (
          viewMode === 'original' ? (
            <TranscriptionResult
              fileId={project.id}
              projectStatus={project.status}
              className="h-full"
              isEditing={isEditing}
              onEditingChange={setIsEditing}
              onSegmentClick={(time) => playerRef.current?.seekTo(time)}
              currentPlayTime={currentPlayTime}
              onStatsChange={setStats}
            />
          ) : (
            <div className="h-full flex flex-col">
              {translationError && (
                <div className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                  {translationError}
                </div>
              )}
              {isTranslating && !translationData ? (
                <div className="flex h-full flex-col items-center justify-center text-gray-400">
                  <Loader2 className="w-10 h-10 animate-spin text-blue-200 mb-2" />
                  <p>正在翻译中，请稍候...</p>
                </div>
              ) : (
                <TranslationView
                  projectId={project.id}
                  viewMode={viewMode}
                  translation={translationData}
                  onSegmentClick={(time) => playerRef.current?.seekTo(time)}
                  currentPlayTime={currentPlayTime}
                />
              )}
            </div>
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center text-gray-400">
            {project.status === 'error' ? (
              <>
                <AlertCircle className="w-12 h-12 text-red-200 mb-2" />
                <p>转写失败</p>
              </>
            ) : (
              <>
                <Loader2 className="w-12 h-12 animate-spin text-blue-100 mb-2" />
                <p>{getProjectStatusText(project.status, 'long')}</p>
                {project.status === 'transcribing' &&
                  project.transcription_progress != null && (
                    <div className="w-48 mt-3">
                      <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500 rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.min(
                              100,
                              project.transcription_progress
                            )}%`,
                          }}
                        />
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        约 {Math.round(project.transcription_progress)}%
                      </p>
                    </div>
                  )}
                <p className="text-xs text-gray-300 mt-2">
                  大文件可能需要较长时间
                </p>
              </>
            )}
          </div>
        )}
      </div>

      <TranslateModal
        open={showTranslateModal}
        targetLanguage={targetLanguage}
        onTargetLanguageChange={setTargetLanguage}
        onClose={() => setShowTranslateModal(false)}
        onConfirm={handleTranslate}
        isTranslating={isTranslating}
      />

      <TranscribeModal
        open={showTranscribeModal}
        projectDisplayName={
          project.display_name?.trim() || project.original_name || '—'
        }
        scenario={transcribeScenario}
        onScenarioChange={setTranscribeScenario}
        teamHomeId={transcribeTeamHomeId}
        onTeamHomeChange={setTranscribeTeamHomeId}
        teamAwayId={transcribeTeamAwayId}
        onTeamAwayChange={setTranscribeTeamAwayId}
        rosterMode={transcribeRosterMode}
        onRosterModeChange={setTranscribeRosterMode}
        keywords={transcribeKeywords}
        onKeywordsChange={setTranscribeKeywords}
        homeSelected={transcribeHomeSelected}
        onHomeSelectedChange={setTranscribeHomeSelected}
        awaySelected={transcribeAwaySelected}
        onAwaySelectedChange={setTranscribeAwaySelected}
        teams={teams}
        homeRosterNames={homeRosterNames}
        awayRosterNames={awayRosterNames}
        preview={transcribePreview}
        previewLoading={transcribePreviewLoading}
        previewTruncated={transcribePreviewTruncated}
        canConfirmTranscribe={canConfirmTranscribe}
        isStarting={isStarting}
        onClose={() => setShowTranscribeModal(false)}
        onConfirm={handleConfirmTranscribe}
        toggleSelected={toggleSelected}
      />
    </div>
  );
};
