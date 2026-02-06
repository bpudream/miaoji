import React, { useEffect, useState } from 'react';
import clsx from 'clsx';
import { getTranscription } from '../../lib/api';
import { extractSegmentsFromContent, formatTime } from './utils';
import type { Segment } from './types';
import type { TranslationViewProps } from './types';
import { AlertCircle } from 'lucide-react';

export const TranslationView: React.FC<TranslationViewProps> = ({
  projectId,
  viewMode,
  translation,
  onSegmentClick,
  currentPlayTime,
}) => {
  const [originalSegments, setOriginalSegments] = useState<Segment[]>([]);

  useEffect(() => {
    let mounted = true;
    const loadOriginal = async () => {
      try {
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
  }, [projectId]);

  const translatedSegments = translation?.content?.segments ?? [];

  if (!translation) {
    return (
      <div className="flex h-full flex-col items-center justify-center text-gray-400">
        <AlertCircle className="w-10 h-10 text-amber-200 mb-2" />
        <p>暂无翻译结果，请先点击“AI 翻译”</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto pb-6">
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
  );
};
