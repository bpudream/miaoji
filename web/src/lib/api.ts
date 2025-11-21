import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: API_URL,
});

export interface Project {
  id: number;
  filename: string;
  original_name: string;
  status: 'pending' | 'extracting' | 'ready_to_transcribe' | 'transcribing' | 'processing' | 'completed' | 'error';
  created_at: string;
  duration?: number; // 音频时长 (秒)
  mime_type?: string; // MIME类型，用于判断音频/视频
  transcription?: {
    content: any;
    format: string;
  };
}

// 兼容旧代码
export type TranscriptionResponse = Project;

export interface UploadResponse {
  status: string;
  path: string;
  filename: string;
  id: number;
}

export interface ProjectsResponse {
  data: Project[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export const uploadFile = async (file: File): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append('file', file);

  const response = await api.post<UploadResponse>('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

// 重命名，推荐使用 getProject
export const getTranscription = async (id: number): Promise<Project> => {
  return getProject(id);
};

export const getProject = async (id: number): Promise<Project> => {
  const response = await api.get<Project>(`/projects/${id}`);
  return response.data;
};

export const getProjects = async (page = 1, pageSize = 10, status?: string): Promise<ProjectsResponse> => {
  const response = await api.get<ProjectsResponse>('/projects', {
    params: { page, pageSize, status }
  });
  return response.data;
};

export const deleteProject = async (id: number): Promise<void> => {
  await api.delete(`/projects/${id}`);
};

export type SummaryMode = 'brief' | 'detailed' | 'key_points';

export interface SummaryResponse {
  status: string;
  summary: string; // Markdown content
  mode: SummaryMode;
}

export interface Summary {
    id: number;
    media_file_id: number;
    content: string;
    model: string;
    mode: string;
    created_at: string;
}

export const generateSummary = async (id: number, mode: SummaryMode): Promise<SummaryResponse> => {
    const response = await api.post<SummaryResponse>(`/projects/${id}/summarize`, { mode });
    return response.data;
};

export const getSummary = async (id: number, mode?: SummaryMode): Promise<Summary> => {
    const response = await api.get<Summary>(`/projects/${id}/summary`, { params: { mode } });
    return response.data;
};

export type ExportFormat = 'txt' | 'json' | 'srt';

export const exportTranscription = async (id: number, format: ExportFormat) => {
  const response = await api.get<Blob>(`/projects/${id}/export`, {
    params: { format },
    responseType: 'blob',
  });

  const disposition = response.headers['content-disposition'] as string | undefined;
  let filename: string | undefined;
  if (disposition) {
    const match = disposition.match(/filename="?(.+?)"?$/i);
    if (match) {
      filename = decodeURIComponent(match[1]);
    }
  }

  return {
    blob: response.data,
    filename,
  };
};

export const updateTranscription = async (id: number, segments: any[]): Promise<void> => {
  await api.put(`/projects/${id}/transcription`, { segments });
};
