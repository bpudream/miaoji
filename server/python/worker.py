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

def transcribe_with_model(
    model: WhisperModel,
    file_path: str,
    total_duration: float = 0,
    on_progress=None,
    on_segment=None,
    options=None
):
    """total_duration: 音频总时长(秒)，用于计算进度。on_progress(req_id, progress_pct) 每段后可选调用。"""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    opts = options or {}
    condition_on_previous_text = opts.get("condition_on_previous_text")
    transcribe_kwargs = {
        "beam_size": 5,
        "language": opts.get("language"),
        # --- 🛡️ VAD 最终定版 (0.15 / 300 / 200) ---
        "vad_filter": True,
        "vad_parameters": {
            # 【核心】0.15：比默认敏锐，能穿透进球欢呼抓取人声，
            # 但又不会像 0.1 那样被噪音“粘住”导致切不开。
            "threshold": 0.15,

            # 【快刀】300ms：专为激情解说设计，抓住每一次换气间隙切断。
            "min_silence_duration_ms": 300,

            # 【胶水】200ms：保护首尾音，防止切分太快吞字。
            "speech_pad_ms": 200
        },
        # "word_timestamps": True,
        "task": opts.get("task", "transcribe"),
        "initial_prompt": opts.get("initial_prompt") or "",

        # "condition_on_previous_text": True if condition_on_previous_text is None else condition_on_previous_text

        # 【修改】体育场景强制设为 False
        "condition_on_previous_text": False,

        # --- 2. 阈值全关 (解决丢失几十秒的核心) ---

        # [关键修改] 设为 None。
        # 告诉模型：哪怕你觉得这是纯噪音 (Probability 99.9%)，也得给我编个字出来！
        # 只有这样才能填补那个 30秒的坑。
        "no_speech_threshold": None,

        # [关键修改] 设为 None。
        # 告诉模型：哪怕你卡住了，复读了 100 遍 "Goal"，也别删掉，原样输出。
        # 我们宁要复读机，不要时间空洞。
        "compression_ratio_threshold": None,

        "log_prob_threshold": None, # 保持关闭
    }
    if opts.get("compression_ratio_threshold") is not None:
        transcribe_kwargs["compression_ratio_threshold"] = opts.get("compression_ratio_threshold")

    segments, info = model.transcribe(
        file_path,
        **transcribe_kwargs
    )

    result_segments = []
    full_text = ""
    last_pct = -1

    for segment in segments:
        seg_data = {
            "start": segment.start,
            "end": segment.end,
            "text": segment.text
        }
        result_segments.append(seg_data)
        full_text += segment.text

        if on_segment:
            on_segment(seg_data)

        if on_progress and total_duration > 0:
            pct = min(100.0, round((segment.end / total_duration) * 100, 1))
            if pct > last_pct:
                last_pct = pct
                on_progress(pct)

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
            total_duration = float(payload.get("duration") or 0)
            if not audio_file:
                raise ValueError("audio_file is required")

            def send_progress(pct):
                msg = {"type": "progress", "id": req_id, "progress_pct": pct}
                print(json.dumps(msg, ensure_ascii=False), flush=True)

            def send_segment(seg):
                msg = {"type": "segment", "id": req_id, "data": seg}
                print(json.dumps(msg, ensure_ascii=False), flush=True)

            result = transcribe_with_model(
                model, audio_file,
                total_duration=total_duration,
                on_progress=send_progress if total_duration > 0 else None,
                on_segment=send_segment,
                options={
                    "initial_prompt": payload.get("initial_prompt", ""),
                    "task": payload.get("task", "transcribe"),
                    "language": payload.get("language"),
                    "condition_on_previous_text": payload.get("condition_on_previous_text", True),
                    "compression_ratio_threshold": payload.get("compression_ratio_threshold")
                }
            )
            response = {"type": "result", "id": req_id, "result": result}
        except Exception as e:
            response = {"type": "result", "id": payload.get("id") if payload else None, "error": str(e)}

        print(json.dumps(response, ensure_ascii=False), flush=True)

if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--server":
        run_server()
    elif len(sys.argv) >= 2:
        run_single_file(sys.argv[1])
    else:
        print(json.dumps({"error": "Usage: python worker.py <file_path> | --server"}, ensure_ascii=False))
