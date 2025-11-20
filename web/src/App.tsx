import { useState } from 'react';
import { Upload } from './components/Upload';
import { TranscriptionResult } from './components/TranscriptionResult';

function App() {
  const [currentFileId, setCurrentFileId] = useState<number | null>(null);

  return (
    <div className="container mx-auto p-8 max-w-3xl">
      <h1 className="text-3xl font-bold mb-8 text-center text-gray-800">Miaoji Local Transcription</h1>

      <div className="space-y-8">
        <section>
          <h2 className="text-xl font-semibold mb-4">1. Upload Audio/Video</h2>
          <Upload onUploadSuccess={setCurrentFileId} />
        </section>

        {currentFileId && (
          <section>
             <h2 className="text-xl font-semibold mb-4">2. Transcription Result</h2>
             <TranscriptionResult fileId={currentFileId} key={currentFileId} />
          </section>
        )}
      </div>
    </div>
  );
}

export default App;

