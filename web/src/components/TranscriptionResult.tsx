import React, { useEffect, useState } from 'react';
import { getTranscription, TranscriptionResponse } from '../lib/api';

interface Props {
  fileId: number;
}

export const TranscriptionResult: React.FC<Props> = ({ fileId }) => {
  const [data, setData] = useState<TranscriptionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let intervalId: any;

    const fetchData = async () => {
      try {
        const result = await getTranscription(fileId);
        setData(result);

        if (result.status === 'completed' || result.status === 'error') {
          clearInterval(intervalId);
        }
      } catch (err: any) {
        setError(err.message);
        clearInterval(intervalId);
      }
    };

    // 立即执行一次
    fetchData();
    // 每2秒轮询一次
    intervalId = setInterval(fetchData, 2000);

    return () => clearInterval(intervalId);
  }, [fileId]);

  if (error) {
    return <div className="text-red-500 p-4">Error: {error}</div>;
  }

  if (!data) {
    return <div className="p-4">Loading...</div>;
  }

  return (
    <div className="mt-4 p-4 border rounded shadow bg-white">
      <h3 className="text-lg font-bold mb-2">Transcription Status: {data.status}</h3>

      {data.status === 'processing' && (
         <div className="flex items-center space-x-2 text-blue-600">
           <span className="animate-spin">⏳</span>
           <span>Transcribing... (This may take a while depending on GPU)</span>
         </div>
      )}

      {data.status === 'completed' && data.transcription && (
        <div className="mt-4">
          <h4 className="font-semibold mb-2">Result:</h4>
          <div className="bg-gray-50 p-4 rounded whitespace-pre-wrap max-h-96 overflow-y-auto font-mono text-sm">
             {/* 如果是 JSON，这里简单展示 text 字段，或者是 segments */}
             {typeof data.transcription.content === 'string'
                ? data.transcription.content
                : (data.transcription.content.text || JSON.stringify(data.transcription.content, null, 2))
             }
          </div>
          {typeof data.transcription.content !== 'string' && data.transcription.content.segments && (
             <div className="mt-4">
                <h4 className="font-semibold mb-2">Segments:</h4>
                <div className="space-y-2">
                   {data.transcription.content.segments.map((seg: any, idx: number) => (
                      <p key={idx} className="text-sm">
                         <span className="text-gray-500">[{seg.start.toFixed(1)}s - {seg.end.toFixed(1)}s]</span> {seg.text}
                      </p>
                   ))}
                </div>
             </div>
          )}
        </div>
      )}
    </div>
  );
};

