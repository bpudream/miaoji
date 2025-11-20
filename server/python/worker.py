import sys
import json
import os
from faster_whisper import WhisperModel

# 强制 stdout 使用 utf-8
sys.stdout.reconfigure(encoding='utf-8')

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODEL_PATH = os.path.join(BASE_DIR, "models", "large-v3")

def ensure_model_path():
    if not os.path.exists(MODEL_PATH):
        raise RuntimeError(f"Model directory not found at: {MODEL_PATH}. Please download the model manually.")

    required_files = ["model.bin", "config.json"]
    for f in required_files:
        if not os.path.exists(os.path.join(MODEL_PATH, f)):
            raise RuntimeError(f"Model file missing: {f} in {MODEL_PATH}")

def create_model():
    ensure_model_path()
    device = os.environ.get("WHISPER_DEVICE", "cuda")
    compute_type = os.environ.get("WHISPER_COMPUTE_TYPE", "float16")
    sys.stderr.write(f"[Worker] Using device={device}, compute_type={compute_type}\n")
    return WhisperModel(MODEL_PATH, device=device, compute_type=compute_type)

def transcribe_with_model(model: WhisperModel, file_path: str):
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    segments, info = model.transcribe(
        file_path,
        beam_size=5,
        language="zh",
        vad_filter=True
    )

    result_segments = []
    full_text = ""

    for segment in segments:
        result_segments.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text
        })
        full_text += segment.text

    return {
        "language": info.language,
        "language_probability": info.language_probability,
        "duration": info.duration,
        "segments": result_segments,
        "text": full_text
    }

def run_single_file(audio_file: str):
    sys.stderr.write(f"[Worker] Received audio file: {audio_file}\n")
    try:
        model = create_model()
        result = transcribe_with_model(model, audio_file)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({"error": f"Transcription failed: {str(e)}"}, ensure_ascii=False))

def run_server():
    sys.stderr.write("[Worker] Starting server mode...\n")
    try:
        model = create_model()
    except Exception as e:
        sys.stderr.write(f"[Worker] Failed to load model: {e}\n")
        print(json.dumps({"error": str(e)}, ensure_ascii=False))
        return

    sys.stderr.write("[Worker] Model loaded. Waiting for tasks...\n")

    while True:
        line = sys.stdin.readline()
        if not line:
            break
        line = line.strip()
        if not line:
            continue

        payload = None
        try:
            payload = json.loads(line)
            audio_file = payload.get("audio_file")
            req_id = payload.get("id")
            if not audio_file:
                raise ValueError("audio_file is required")

            result = transcribe_with_model(model, audio_file)
            response = {"id": req_id, "result": result}
        except Exception as e:
            response = {"id": payload.get("id") if payload else None, "error": str(e)}

        print(json.dumps(response, ensure_ascii=False))
        sys.stdout.flush()

if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--server":
        run_server()
    elif len(sys.argv) >= 2:
        run_single_file(sys.argv[1])
    else:
        print(json.dumps({"error": "Usage: python worker.py <file_path> | --server"}, ensure_ascii=False))
