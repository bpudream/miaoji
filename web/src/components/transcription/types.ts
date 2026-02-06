import type { Project } from '../../lib/api';
import type { TranslationResponse } from '../../lib/api';

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface TranscriptionResultProps {
  fileId: string;
  projectStatus?: Project['status'];
  className?: string;
  isEditing?: boolean;
  onEditingChange?: (editing: boolean) => void;
  onSegmentClick?: (time: number) => void;
  currentPlayTime?: number;
  onStatsChange?: (stats: {
    segmentCount: number;
    duration: number | null;
    lastSaved: Date | null;
  }) => void;
}

export type FilterMode = 'all' | 'edited';
export type ViewMode = 'original' | 'translated' | 'bilingual';

export interface TranscriptionPanelProps {
  project: Project;
  className?: string;
  playerRef: React.RefObject<{ seekTo: (time: number) => void }>;
  currentPlayTime: number;
}

export interface TranslationViewProps {
  projectId: string;
  viewMode: 'translated' | 'bilingual';
  translation: TranslationResponse | null;
  onSegmentClick?: (time: number) => void;
  currentPlayTime: number;
}
