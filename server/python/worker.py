import sys
import json
import os
from faster_whisper import WhisperModel

# 强制 stdout 使用 utf-8
sys.stdout.reconfigure(encoding='utf-8')

def transcribe(file_path):
    # 1. 输入文件检查
    if not os.path.exists(file_path):
        return {"error": f"File not found: {file_path}"}

    # 2. 模型路径检查 (Fast Fail)
    # 约定：模型必须位于 project_root/models/large-v3
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    model_path = os.path.join(base_dir, "models", "large-v3")

    if not os.path.exists(model_path):
        return {"error": f"Model directory not found at: {model_path}. Please download the model manually."}

    # 检查关键文件是否存在，确保模型完整
    required_files = ["model.bin", "config.json"]
    for f in required_files:
        if not os.path.exists(os.path.join(model_path, f)):
            return {"error": f"Model file missing: {f} in {model_path}"}

    try:
        # 3. 加载模型
        # faster-whisper 传入本地路径时，不会尝试下载
        model = WhisperModel(model_path, device="cuda", compute_type="int8")

        # 4. 执行转写
        segments, info = model.transcribe(
            file_path,
            beam_size=5,
            language="zh",
            vad_filter=True
        )

        # 5. 收集结果
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

    except Exception as e:
        # 捕获模型加载或推理过程中的任何其他错误
        return {"error": f"Transcription failed: {str(e)}"}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: python worker.py <file_path>"}))
        sys.exit(1)

    audio_file = sys.argv[1]
    result = transcribe(audio_file)
    # 确保最后只输出一行 JSON
    print(json.dumps(result, ensure_ascii=False))
