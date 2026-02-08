import React, { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { getTranscription } from '../../lib/api';
import { extractSegmentsFromContent, formatTime } from './utils';
import type { Segment } from './types';
import type { TranslationViewProps } from './types';
import { AlertCircle, Anchor } from 'lucide-react';

export const TranslationView: React.FC<TranslationViewProps> = ({
  projectId,
  viewMode,
  translation,
  streamSegments,
  onSegmentClick,
  currentPlayTime,
}) => {
  const [originalSegments, setOriginalSegments] = useState<Segment[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const segmentRefs = useRef<Array<HTMLDivElement | null>>([]);
  const hasStreamSegments = Boolean(streamSegments && streamSegments.length > 0);

  useEffect(() => {
    let mounted = true;
    const loadOriginal = async () => {
      try {
        if (hasStreamSegments && streamSegments) {
          const next = streamSegments.map((seg) => ({
            start: seg.start,
            end: seg.end,
            text: seg.original,
          }));
          if (mounted) setOriginalSegments(next);
          return;
        }
        const res = await getTranscription(projectId);
        const segments = extractSegmentsFromContent(res.transcription?.content);
        if (mounted) setOriginalSegments(segments);
      } catch {
        if (mounted) setOriginalSegments([]);
      }
    };
    loadOriginal();
    return () => {
      mounted = false;
    };
  }, [projectId, hasStreamSegments, streamSegments]);

  const translatedSegments = hasStreamSegments
    ? streamSegments!.map((seg) => ({ text: seg.translation ?? '' }))
    : (translation?.content?.segments ?? []);

  useEffect(() => {
    if (currentPlayTime > 0 && autoScroll) {
      const currentIndex = originalSegments.findIndex(
        (seg) => currentPlayTime >= seg.start && currentPlayTime < seg.end
      );
      if (currentIndex >= 0 && segmentRefs.current[currentIndex]) {
        segmentRefs.current[currentIndex]?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      }
    }
  }, [currentPlayTime, originalSegments, autoScroll]);

  if (!translation && !hasStreamSegments) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-gray-400">
        <AlertCircle className="w-10 h-10 text-amber-200 mb-2" />
        <p>暂无翻译结果，请先点击“AI 翻译”</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-shrink-0 flex items-center justify-end gap-2 pb-3">
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          className={clsx(
            'h-9 px-3 rounded-full border text-sm flex items-center gap-1 transition-colors whitespace-nowrap',
            autoScroll
              ? 'bg-blue-50 text-blue-600 border-blue-200'
              : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
          )}
          title={autoScroll ? '已开启自动跟随' : '点击开启自动跟随'}
        >
          <Anchor className={clsx('w-3.5 h-3.5', autoScroll && 'fill-current')} />
          <span className="hidden sm:inline">
            {autoScroll ? '跟随中' : '不跟随'}
          </span>
          <span className="sm:hidden">{autoScroll ? '跟随' : '静止'}</span>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto pb-6">
        {originalSegments.map((seg, index) => {
          const translated = translatedSegments[index]?.text ?? '';
          const isActive =
            typeof seg.start === 'number' &&
            typeof seg.end === 'number' &&
            currentPlayTime >= seg.start &&
            currentPlayTime <= seg.end;
          return (
            <div
              key={index}
              ref={(el) => (segmentRefs.current[index] = el)}
              className={clsx(
                'rounded-lg border border-gray-100 p-3 mb-3 cursor-pointer hover:bg-gray-50 transition-colors',
                isActive && 'border-blue-200 bg-blue-50/50'
              )}
              onClick={() => {
                if (typeof seg.start === 'number') onSegmentClick?.(seg.start);
              }}
            >
              <div className="text-xs text-gray-400 mb-2">
                {typeof seg.start === 'number' ? formatTime(seg.start) : '--:--'}
              </div>
              {viewMode === 'bilingual' && (
                <p className="text-sm text-gray-700 mb-1">{seg.text}</p>
              )}
              <p className="text-sm text-gray-900">{translated || ''}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
};
