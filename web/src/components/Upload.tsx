import React, { useState } from 'react';
import { uploadFile } from '../lib/api';

interface Props {
  onUploadSuccess: (id: number) => void;
}

export const Upload: React.FC<Props> = ({ onUploadSuccess }) => {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);

    try {
      const result = await uploadFile(file);
      onUploadSuccess(result.id);
    } catch (err: any) {
      setError(err.message || 'Upload failed');
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 border-2 border-dashed border-gray-300 rounded-lg text-center hover:border-blue-500 transition-colors">
      <input
        type="file"
        onChange={handleFileChange}
        disabled={uploading}
        className="hidden"
        id="file-upload"
        accept="audio/*,video/*"
      />
      <label
        htmlFor="file-upload"
        className="cursor-pointer block w-full h-full py-8 text-gray-600"
      >
        {uploading ? (
          <span>Uploading...</span>
        ) : (
          <span>Click to select audio/video file</span>
        )}
      </label>
      {error && <p className="text-red-500 mt-2">{error}</p>}
    </div>
  );
};

