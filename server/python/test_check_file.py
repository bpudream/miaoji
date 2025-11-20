import os
from faster_whisper import WhisperModel

file_path = r"server/uploads/1763621637765-test.m4a"
# 转换为绝对路径
file_path = os.path.abspath(file_path)

if not os.path.exists(file_path):
    print(f"File not found: {file_path}")
else:
    print(f"File size: {os.path.getsize(file_path)}")
    try:
        # 尝试简单加载
        base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        model_path = os.path.join(base_dir, "models", "large-v3")
        print(f"Loading model from {model_path}")
        model = WhisperModel(model_path, device="cuda", compute_type="int8")
        print("Model loaded. Transcribing...")
        segments, info = model.transcribe(file_path, beam_size=1) # beam_size 1 for speed
        # 只读第一个 segment
        for segment in segments:
            print(segment.text)
            break
        print("Transcribe check passed")
    except Exception as e:
        print(f"Error: {e}")

