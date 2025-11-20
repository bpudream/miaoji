import axios from 'axios';

const API_URL = 'http://localhost:3000/api';

export const api = axios.create({
  baseURL: API_URL,
});

export interface UploadResponse {
  status: string;
  path: string;
  filename: string;
  id: number;
}

export interface TranscriptionResponse {
  id: number;
  filename: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  created_at: string;
  transcription?: {
    content: any; // JSON or string
    format: string;
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

export const getTranscription = async (id: number): Promise<TranscriptionResponse> => {
  const response = await api.get<TranscriptionResponse>(`/transcriptions/${id}`);
  return response.data;
};

