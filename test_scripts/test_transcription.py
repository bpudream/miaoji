
import time
import os
from faster_whisper import WhisperModel

def transcribe_file(file_path):
    if not os.path.exists(file_path):
        print(f"[ERROR] File not found: {file_path}")
        return

    print(f"Loading model (large-v3)...")
    # 使用本地 large-v3 模型
    # 请确保模型文件已下载到项目根目录下的 models/large-v3 文件夹
    model_path = "models/large-v3"

    if not os.path.exists(model_path):
        print(f"[ERROR] Model path not found: {model_path}")
        print("Please download model files to this directory manually.")
        return

    model = WhisperModel(model_path, device="cuda", compute_type="int8")

    print(f"Start transcribing: {file_path}")
    start_time = time.time()

    segments, info = model.transcribe(
        file_path,
        beam_size=5,
        language="zh",  # 强制指定中文，或者去掉自动检测
        vad_filter=True # 开启语音活动检测
    )

    print(f"Detected language '{info.language}' with probability {info.language_probability:.2f}")

    # faster-whisper 的 segments 是一个生成器，必须遍历它才会真正开始转写
    count = 0

    # 准备输出文件路径
    output_file = os.path.splitext(file_path)[0] + "_transcription.txt"

    print(f"Writing results to: {output_file}")

    with open(output_file, "w", encoding="utf-8") as f:
        for segment in segments:
            # 控制台输出
            line = f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}"
            print(line)

            # 写入文件（只写入文本，或者也可以包含时间戳，这里为了总结方便，只写文本）
            # 如果需要包含时间戳，可以使用 f.write(line + "\n")
            f.write(segment.text + "\n")

            count += 1

    end_time = time.time()
    duration = end_time - start_time

    print(f"\n[DONE] Transcription finished in {duration:.2f}s")
    print(f"Total segments: {count}")

if __name__ == "__main__":
    # 确保 sample 目录存在，这里使用相对路径
    audio_file = "sample/test.m4a"
    transcribe_file(audio_file)
