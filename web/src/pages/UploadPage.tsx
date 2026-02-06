import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { uploadFile, continueUploadDuplicate, type DuplicateFileInfo } from '../lib/api';
import { Upload, Loader2, FileAudio, AlertCircle, X } from 'lucide-react';
import { clsx } from 'clsx';
import { DuplicateFileDialog } from '../components/DuplicateFileDialog';

const FILE_SIZE_THRESHOLD = 100 * 1024 * 1024; // 100MB

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
};

export const UploadPage = () => {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadingFile, setUploadingFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateInfo, setDuplicateInfo] = useState<{
    duplicate: DuplicateFileInfo;
    fileHash: string;
    tempFilePath: string;
    mimeType?: string;
    originalFilename?: string;
  } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const navigate = useNavigate();

  const handleCancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setIsUploading(false);
    setUploadProgress(null);
    setUploadingFile(null);
    setError(null);
  };

  const handleFile = async (file: File, forceUpload = false) => {
    setIsUploading(true);
    setError(null);
    setDuplicateInfo(null);
    setUploadingFile(file);
    setUploadProgress(null);

    // 创建新的 AbortController
    abortControllerRef.current = new AbortController();
    const showProgress = file.size > FILE_SIZE_THRESHOLD;

    try {
      const res = await uploadFile(
        file,
        forceUpload,
        showProgress ? (progress) => {
          setUploadProgress(progress);
        } : undefined,
        abortControllerRef.current.signal
      );

      if (res.status === 'duplicate' && res.duplicate && res.file_hash && res.temp_file_path) {
        // 检测到重复文件
        setDuplicateInfo({
          duplicate: res.duplicate,
          fileHash: res.file_hash,
          tempFilePath: res.temp_file_path,
          mimeType: (res as any).mime_type,
          originalFilename: (res as any).original_filename
        });
        setIsUploading(false);
      } else if (res.status === 'success' && res.id) {
        // 上传成功，跳转到详情页
        navigate(`/projects/${res.id}`);
      } else {
        throw new Error('Unexpected response format');
      }
    } catch (err: any) {
      // 如果是取消操作，不显示错误
      if (err.name === 'CanceledError' || err.message === 'canceled' || abortControllerRef.current?.signal.aborted) {
        setIsUploading(false);
        setUploadProgress(null);
        setUploadingFile(null);
        abortControllerRef.current = null;
        return;
      }

      console.error(err);

      // 增强错误信息显示
      let errorMessage = '上传失败，请重试';
      if (err.response) {
        // 服务器响应错误
        errorMessage = `服务器错误 (${err.response.status}): ${err.response.data?.message || err.response.statusText}`;
      } else if (err.request) {
        // 网络请求发出但无响应
        errorMessage = '网络连接失败。请检查：1. 手机是否连接了同一WiFi 2. 电脑防火墙是否允许端口 3000 (后端) 和 5173 (前端) 3. 后端服务是否正在运行';
      } else {
        // 其他错误
        errorMessage = err.message || errorMessage;
      }

      setError(errorMessage);
      setIsUploading(false);
      setUploadProgress(null);
      setUploadingFile(null);
      abortControllerRef.current = null;
    }
  };

  const handleContinueUpload = async () => {
    if (!duplicateInfo) return;

    setIsUploading(true);
    setError(null);
    setUploadProgress(null);

    // 创建新的 AbortController
    abortControllerRef.current = new AbortController();

    try {
      const res = await continueUploadDuplicate(
        duplicateInfo.tempFilePath,
        duplicateInfo.fileHash,
        duplicateInfo.mimeType,
        duplicateInfo.originalFilename,
        abortControllerRef.current.signal
      );
      if (res.status === 'success' && res.id) {
        // 上传成功，跳转到详情页
        navigate(`/projects/${res.id}`);
      } else {
        throw new Error('Continue upload failed');
      }
    } catch (err: any) {
      // 如果是取消操作，不显示错误
      if (err.name === 'CanceledError' || err.message === 'canceled' || abortControllerRef.current?.signal.aborted) {
        setIsUploading(false);
        setUploadProgress(null);
        setDuplicateInfo(null);
        setUploadingFile(null);
        abortControllerRef.current = null;
        return;
      }

      console.error(err);
      setError(err.response?.data?.error || '继续上传失败，请重试');
      setIsUploading(false);
      setUploadProgress(null);
      abortControllerRef.current = null;
    } finally {
      if (!abortControllerRef.current?.signal.aborted) {
        setDuplicateInfo(null);
        setUploadingFile(null);
      }
    }
  };

  const handleCancelDuplicate = () => {
    setDuplicateInfo(null);
    setIsUploading(false);
    setUploadProgress(null);
    setUploadingFile(null);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0]);
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-0">
      <h2 className="text-xl md:text-2xl font-bold mb-4 md:mb-6 text-gray-800">上传音视频</h2>

      <div
        className={clsx(
          "border-2 border-dashed rounded-2xl p-6 md:p-12 text-center transition-all min-h-[300px] md:min-h-[400px] flex flex-col justify-center items-center",
          isDragging ? "border-blue-500 bg-blue-50" : "border-gray-300 hover:border-blue-400 bg-white",
          isUploading && "opacity-50 pointer-events-none bg-gray-50"
        )}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        {isUploading ? (
          <div className="py-8 animate-in fade-in zoom-in duration-300 w-full max-w-md mx-auto">
            <Loader2 className="w-16 h-16 text-blue-500 animate-spin mx-auto mb-6" />
            <p className="text-xl font-medium text-gray-900 mb-2">正在上传...</p>
            {uploadProgress !== null && uploadingFile ? (
              <div className="space-y-3 mt-4">
                <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                  <div
                    className="bg-blue-500 h-full transition-all duration-300 ease-out rounded-full"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <div className="flex justify-between text-sm text-gray-600">
                  <span>{uploadProgress}%</span>
                  <span>
                    {formatFileSize((uploadingFile.size * uploadProgress) / 100)} / {formatFileSize(uploadingFile.size)}
                  </span>
                </div>
                <button
                  onClick={handleCancelUpload}
                  className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors flex items-center gap-2 mx-auto text-sm font-medium"
                >
                  <X className="w-4 h-4" />
                  取消上传
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-gray-500 mt-2">请不要关闭页面，大文件可能需要一些时间</p>
                <button
                  onClick={handleCancelUpload}
                  className="mt-4 px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors flex items-center gap-2 mx-auto text-sm font-medium"
                >
                  <X className="w-4 h-4" />
                  取消上传
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="animate-in fade-in zoom-in duration-300">
            <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-8">
              <Upload className="w-12 h-12 text-blue-500" />
            </div>
            <p className="text-2xl font-medium text-gray-900 mb-4">
              拖拽文件到这里
            </p>
            <p className="text-gray-500 mb-8">
              或者
              <label className="text-blue-600 hover:underline hover:text-blue-700 cursor-pointer ml-1 font-medium">
                点击选择文件
                <input type="file" className="hidden" onChange={onChange} accept="audio/*,video/*,.mkv,.mp4,.mov,.avi,.webm,.mp3,.wav,.m4a,.aac,.flac,.ogg" />
              </label>
            </p>
            <div className="flex items-center justify-center gap-2 text-sm text-gray-400 bg-gray-50 py-2 px-4 rounded-full w-fit mx-auto">
              <FileAudio className="w-4 h-4" />
              支持 MP3, WAV, M4A, MP4, MOV, MKV 等格式 (最大 4GB)
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="mt-6 p-4 bg-red-50 rounded-xl flex items-start gap-3 text-red-700 border border-red-100 animate-in slide-in-from-top-2">
          <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium">上传出错</h4>
            <p className="text-sm mt-1 opacity-90">{error}</p>
          </div>
        </div>
      )}

      {duplicateInfo && (
        <DuplicateFileDialog
          duplicate={duplicateInfo.duplicate}
          onContinue={handleContinueUpload}
          onCancel={handleCancelDuplicate}
        />
      )}
    </div>
  );
};

