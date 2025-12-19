import axios from 'axios';
import { getBackendUrlStatic } from '../hooks/useBackendUrl';

// 获取后端地址
// 使用统一的配置逻辑（支持环境变量配置端口、自动适配局域网访问）
const getBackendUrl = (): string => {
  return getBackendUrlStatic();
};

// 动态获取 API URL
export const getApiUrl = (): string => {
  const backendUrl = getBackendUrl();
  // 如果 backendUrl 为空（生产环境通过 Nginx 代理），使用相对路径
  if (!backendUrl) {
    // 生产环境部署在 /miaoji 路径下
    return import.meta.env.PROD ? '/miaoji/api' : '/api';
  }
  return `${backendUrl}/api`;
};

// 获取当前后端地址（只读，从环境变量读取）
export const getBackendUrlConfig = (): string => {
  return getBackendUrl();
};

export const API_URL = getApiUrl();

export const api = axios.create({
  baseURL: API_URL,
});

// 注意：后端地址现在从环境变量读取，不再支持动态修改
// 如果需要修改后端地址，请更新 .env 文件中的 VITE_BACKEND_URL 并重启前端开发服务器

export interface Project {
  id: string;
  filename: string;
  original_name: string;
  display_name?: string | null; // 用户自定义的显示名称
  status: 'pending' | 'extracting' | 'ready_to_transcribe' | 'transcribing' | 'processing' | 'completed' | 'error';
  created_at: string;
  duration?: number; // 音频时长 (秒)
  mime_type?: string; // MIME类型，用于判断音频/视频
  audio_path?: string; // 提取的音频文件路径
  filepath?: string; // 文件存储路径
  size?: number; // 文件大小（字节）
  summary_count?: number; // 总结数量
  transcription?: {
    content: any;
    format: string;
  };
}

// 兼容旧代码
export type TranscriptionResponse = Project;

export interface DuplicateFileInfo {
  id: string;
  name: string;
  original_name: string;
  status: string;
  created_at: string;
  filepath: string;
}

export interface UploadResponse {
  status: 'success' | 'duplicate';
  path?: string;
  filename?: string;
  id?: string;
  duplicate?: DuplicateFileInfo;
  file_hash?: string;
  temp_file_path?: string;
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

export const uploadFile = async (
  file: File,
  forceUpload = false,
  onProgress?: (progress: number) => void,
  abortSignal?: AbortSignal
): Promise<UploadResponse> => {
  const formData = new FormData();
  formData.append('file', file);
  if (forceUpload) {
    formData.append('force_upload', 'true');
  }

  const response = await api.post<UploadResponse>('/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
    signal: abortSignal,
    onUploadProgress: (progressEvent) => {
      if (onProgress && progressEvent.total) {
        const percentCompleted = Math.round((progressEvent.loaded * 100) / progressEvent.total);
        onProgress(percentCompleted);
      }
    },
  });
  return response.data;
};

// 继续上传重复文件（使用临时文件路径）
export const continueUploadDuplicate = async (
  tempFilePath: string,
  fileHash: string,
  mimeType?: string,
  originalFilename?: string,
  abortSignal?: AbortSignal
): Promise<UploadResponse> => {
  const response = await api.post<UploadResponse>('/upload/continue', {
    temp_file_path: tempFilePath,
    file_hash: fileHash,
    mime_type: mimeType,
    original_filename: originalFilename
  }, {
    signal: abortSignal
  });

  return response.data;
};

// 重命名，推荐使用 getProject
export const getTranscription = async (id: string): Promise<Project> => {
  return getProject(id);
};

export const getProject = async (id: string): Promise<Project> => {
  const response = await api.get<Project>(`/projects/${id}`);
  return response.data;
};

export const getProjects = async (page = 1, pageSize = 10, status?: string): Promise<ProjectsResponse> => {
  const response = await api.get<ProjectsResponse>('/projects', {
    params: { page, pageSize, status }
  });
  return response.data;
};

export const deleteProject = async (id: string): Promise<void> => {
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

export const generateSummary = async (id: string, mode: SummaryMode): Promise<SummaryResponse> => {
    const response = await api.post<SummaryResponse>(`/projects/${id}/summarize`, { mode });
    return response.data;
};

export const getSummary = async (id: string, mode?: SummaryMode): Promise<Summary> => {
    const response = await api.get<Summary>(`/projects/${id}/summary`, { params: { mode } });
    return response.data;
};

export type ExportFormat = 'txt' | 'json' | 'srt';

export const exportTranscription = async (id: string, format: ExportFormat) => {
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

export const updateTranscription = async (id: string, segments: any[]): Promise<void> => {
  await api.put(`/projects/${id}/transcription`, { segments });
};

// 更新项目显示名称
export const updateProjectName = async (id: string, displayName: string | null): Promise<{
  status: string;
  id: string;
  original_name: string;
  display_name: string | null;
}> => {
  const response = await api.put(`/projects/${id}/name`, { display_name: displayName });
  return response.data;
};

export interface NetworkInterface {
  name: string;
  ip: string;
  type: 'wifi' | 'ethernet' | 'other' | 'virtual' | 'bluetooth';
  priority: number;
}

export interface SystemStatus {
  interfaces: NetworkInterface[];
  defaultIP: string;
  frontendPort: number | null; // 可能为 null，如果前端没有提供端口信息
  backendPort: number;
  frontendUrl: string | null; // 可能为 null，如果前端没有提供端口信息
  backendUrl: string;
  timestamp: string;
}

export interface ConnectionTestResult {
  success: boolean;
  status?: number;
  url: string;
  message: string;
  error?: string;
}

export const getSystemStatus = async (): Promise<SystemStatus> => {
  const frontendPort = getFrontendPort();
  const response = await api.get<SystemStatus>('/system/status', {
    headers: frontendPort ? { 'x-frontend-port': String(frontendPort) } : {},
  });
  return response.data;
};

export const testConnection = async (ip: string, port?: string): Promise<ConnectionTestResult> => {
  const response = await api.get<ConnectionTestResult>('/system/test-connection', {
    params: { ip, port },
  });
  return response.data;
};

export interface PortInfo {
  backendPort: number;
  frontendPort: number | null; // 可能为 null，如果无法获取
}

// 获取当前前端端口
const getFrontendPort = (): number | null => {
  const port = window.location.port;
  if (port) {
    return parseInt(port, 10);
  }
  // 如果是默认端口（http 80, https 443），port 为空
  const protocol = window.location.protocol;
  if (protocol === 'https:') {
    return 443;
  }
  if (protocol === 'http:') {
    return 80;
  }
  return null;
};

export const getPortInfo = async (): Promise<PortInfo> => {
  const frontendPort = getFrontendPort();
  const response = await api.get<PortInfo>('/system/ports', {
    headers: frontendPort ? { 'x-frontend-port': String(frontendPort) } : {},
  });
  return response.data;
};

// 测试当前配置的后端连接
export const testBackendConnection = async (): Promise<{ success: boolean; message: string }> => {
  try {
    const response = await api.get('/health', { timeout: 3000 });
    return {
      success: response.status === 200,
      message: '连接成功',
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.code === 'ECONNABORTED' ? '连接超时' : '连接失败',
    };
  }
};

// ========== 存储路径管理 API ==========

export interface StorageInfo {
  total: number;      // 总容量（字节）
  used: number;       // 已用空间（字节）
  free: number;       // 可用空间（字节）
  usagePercent: number; // 使用百分比
}

export interface StoragePath {
  id: number;
  name: string;
  path: string;
  enabled: boolean;
  priority: number;
  max_size_gb: number | null;
  created_at: string;
  updated_at: string;
  info?: StorageInfo;
}

export interface StoragePathsResponse {
  status: string;
  paths: StoragePath[];
}

export interface StoragePathResponse {
  status: string;
  path: StoragePath;
}

export interface MigrateFilesRequest {
  file_ids: string[];
  target_path_id: number;
  delete_source?: boolean;
}

export interface MigrateFilesResponse {
  status: string;
  total: number;
  success: number;
  failed: number;
  results: Array<{ fileId: string; success: boolean; message: string }>;
}

// 获取所有存储路径
export const getStoragePaths = async (): Promise<StoragePath[]> => {
  const response = await api.get<StoragePathsResponse>('/storage/paths');
  return response.data.paths;
};

// 添加存储路径
export const addStoragePath = async (data: {
  name: string;
  path: string;
  priority?: number;
  max_size_gb?: number | null;
}): Promise<StoragePath> => {
  const response = await api.post<StoragePathResponse>('/storage/paths', data);
  return response.data.path;
};

// 更新存储路径
export const updateStoragePath = async (
  id: number,
  data: {
    name?: string;
    enabled?: boolean;
    priority?: number;
    max_size_gb?: number | null;
  }
): Promise<StoragePath> => {
  const response = await api.put<StoragePathResponse>(`/storage/paths/${id}`, data);
  return response.data.path;
};

// 删除存储路径
export const deleteStoragePath = async (id: number): Promise<void> => {
  await api.delete(`/storage/paths/${id}`);
};

// 获取存储路径信息
export const getStoragePathInfo = async (id: number): Promise<StoragePath> => {
  const response = await api.get<StoragePathResponse>(`/storage/paths/${id}/info`);
  return response.data.path;
};

// 迁移文件
export const migrateFiles = async (data: MigrateFilesRequest): Promise<MigrateFilesResponse> => {
  const response = await api.post<MigrateFilesResponse>('/storage/migrate', data);
  return response.data;
};