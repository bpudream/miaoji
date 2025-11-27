import time
import os
import json
import requests
from faster_whisper import WhisperModel

def format_timestamp(seconds):
    """将秒数转换为 SRT 时间格式 (HH:MM:SS,mmm)"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    millis = int((seconds % 1) * 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

def get_output_dir(video_file):
    """根据视频文件路径创建输出目录"""
    base_name = os.path.splitext(os.path.basename(video_file))[0]
    output_dir = os.path.join("output", base_name)
    os.makedirs(output_dir, exist_ok=True)
    return output_dir

def transcribe_japanese(file_path, output_dir):
    """转写日文视频/音频文件，并保存到输出目录"""
    if not os.path.exists(file_path):
        print(f"[ERROR] File not found: {file_path}")
        return None

    print(f"Loading model (large-v3)...")
    model_path = "models/large-v3"

    if not os.path.exists(model_path):
        print(f"[ERROR] Model path not found: {model_path}")
        print("Please download model files to this directory manually.")
        return None

    model = WhisperModel(model_path, device="cuda", compute_type="int8")

    print(f"Start transcribing Japanese: {file_path}")
    start_time = time.time()

    segments, info = model.transcribe(
        file_path,
        beam_size=5,
        language="ja",  # 指定日文
        vad_filter=True  # 开启语音活动检测
    )

    print(f"Detected language '{info.language}' with probability {info.language_probability:.2f}")

    # 收集所有片段
    segment_list = []
    for segment in segments:
        segment_list.append({
            "start": segment.start,
            "end": segment.end,
            "text": segment.text.strip()
        })
        print(f"[{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")

    end_time = time.time()
    duration = end_time - start_time

    print(f"\n[DONE] Transcription finished in {duration:.2f}s")
    print(f"Total segments: {len(segment_list)}")

    # 保存转写结果到JSON文件
    transcription_file = os.path.join(output_dir, "transcription.json")
    with open(transcription_file, "w", encoding="utf-8") as f:
        json.dump({
            "language": info.language,
            "language_probability": info.language_probability,
            "segments": segment_list
        }, f, ensure_ascii=False, indent=2)

    print(f"[SAVED] Transcription saved to: {transcription_file}")

    # 同时保存为纯文本文件（方便查看）
    text_file = os.path.join(output_dir, "transcription.txt")
    with open(text_file, "w", encoding="utf-8") as f:
        for segment in segment_list:
            f.write(f"[{segment['start']:.2f}s -> {segment['end']:.2f}s] {segment['text']}\n")

    print(f"[SAVED] Transcription text saved to: {text_file}")

    return segment_list

def translate_with_ollama(text, model="qwen3:14b"):
    """使用 Ollama 将日文翻译成中文"""
    print(f"Translating with Ollama ({model})...")

    prompt = f"""请将以下日文文本翻译成中文。要求：
1. 翻译准确、自然流畅
2. 保持原文的语气和风格
3. 只输出翻译后的中文，不要添加任何解释或注释

日文文本：
{text}
"""

    try:
        response = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": False
            },
            timeout=300
        )

        response.raise_for_status()
        result = response.json()
        translated_text = result['response'].strip()

        # 清理可能的额外说明文字
        if "翻译" in translated_text[:50] or "中文" in translated_text[:50]:
            # 尝试提取实际翻译内容
            lines = translated_text.split('\n')
            translated_text = '\n'.join([line for line in lines if not line.startswith('翻译') and not line.startswith('中文')])

        return translated_text

    except requests.exceptions.ConnectionError:
        print("[ERROR] Could not connect to Ollama. Is it running?")
        print("Run 'ollama serve' in a separate terminal.")
        return None
    except Exception as e:
        print(f"[ERROR] Failed to translate: {e}")
        return None

def load_transcription(transcription_file):
    """从JSON文件加载转写结果"""
    if not os.path.exists(transcription_file):
        print(f"[ERROR] Transcription file not found: {transcription_file}")
        return None

    with open(transcription_file, "r", encoding="utf-8") as f:
        data = json.load(f)
        return data.get("segments", [])

def translate_segments(segments, model="qwen3:14b"):
    """批量翻译所有片段"""
    print(f"\nTranslating {len(segments)} segments...")
    translated_segments = []

    for i, segment in enumerate(segments, 1):
        print(f"Translating segment {i}/{len(segments)}...")
        translated_text = translate_with_ollama(segment["text"], model)

        if translated_text:
            translated_segments.append({
                "start": segment["start"],
                "end": segment["end"],
                "text": translated_text
            })
        else:
            # 如果翻译失败，保留原文
            print(f"[WARNING] Translation failed for segment {i}, keeping original text")
            translated_segments.append({
                "start": segment["start"],
                "end": segment["end"],
                "text": segment["text"]
            })

        # 避免请求过快
        time.sleep(0.5)

    return translated_segments

def write_srt_file(segments, output_file):
    """将片段写入 SRT 格式文件"""
    print(f"\nWriting SRT file: {output_file}")

    with open(output_file, "w", encoding="utf-8") as f:
        for i, segment in enumerate(segments, 1):
            start_time = format_timestamp(segment["start"])
            end_time = format_timestamp(segment["end"])
            text = segment["text"]

            # SRT 格式
            f.write(f"{i}\n")
            f.write(f"{start_time} --> {end_time}\n")
            f.write(f"{text}\n")
            f.write("\n")

    print(f"[DONE] SRT file saved: {output_file}")

def step1_transcribe(video_file):
    """步骤1: 转写日文视频"""
    print("="*60)
    print("Step 1: Japanese Video Transcription")
    print("="*60)

    output_dir = get_output_dir(video_file)
    print(f"Output directory: {output_dir}")

    segments = transcribe_japanese(video_file, output_dir)
    if not segments:
        print("[ERROR] Transcription failed")
        return None

    print("\n" + "="*60)
    print("Step 1 completed!")
    print("="*60)
    return output_dir

def step2_translate_and_generate_srt(output_dir, model="qwen3:14b"):
    """步骤2: 翻译并生成SRT文件"""
    print("\n" + "="*60)
    print("Step 2: Translation & SRT Generation")
    print("="*60)

    transcription_file = os.path.join(output_dir, "transcription.json")

    # 加载转写结果
    segments = load_transcription(transcription_file)
    if not segments:
        print("[ERROR] Failed to load transcription")
        return

    # 翻译
    translated_segments = translate_segments(segments, model)

    # 生成 SRT 文件
    srt_file = os.path.join(output_dir, "chinese.srt")
    write_srt_file(translated_segments, srt_file)

    print("\n" + "="*60)
    print("Step 2 completed!")
    print("="*60)

def process_japanese_video(video_file, model="qwen3:14b", skip_transcribe=False):
    """完整流程：转写 -> 翻译 -> 生成 SRT"""
    print("="*60)
    print("Japanese Video Transcription & Translation to SRT")
    print("="*60)

    output_dir = get_output_dir(video_file)
    print(f"Output directory: {output_dir}")

    # 步骤1: 转写（如果未跳过）
    if not skip_transcribe:
        segments = transcribe_japanese(video_file, output_dir)
        if not segments:
            print("[ERROR] Transcription failed")
            return
    else:
        # 从已有文件加载
        transcription_file = os.path.join(output_dir, "transcription.json")
        segments = load_transcription(transcription_file)
        if not segments:
            print("[ERROR] Failed to load transcription")
            return

    # 步骤2: 翻译
    translated_segments = translate_segments(segments, model)

    # 步骤3: 生成 SRT 文件
    srt_file = os.path.join(output_dir, "chinese.srt")
    write_srt_file(translated_segments, srt_file)

    print("\n" + "="*60)
    print("All done!")
    print("="*60)

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage:")
        print("  Step 1 (Transcribe only):")
        print("    python test_japanese_translation_srt.py transcribe <video_file>")
        print("  Step 2 (Translate & Generate SRT):")
        print("    python test_japanese_translation_srt.py translate <output_dir> [model]")
        print("  Full process:")
        print("    python test_japanese_translation_srt.py full <video_file> [model]")
        print("\nExample:")
        print("  python test_japanese_translation_srt.py transcribe sample/30080.mp4")
        print("  python test_japanese_translation_srt.py translate output/30080 qwen3:14b")
        print("  python test_japanese_translation_srt.py full sample/30080.mp4 qwen3:14b")
        sys.exit(1)

    command = sys.argv[1]

    if command == "transcribe":
        # 步骤1: 只转写
        if len(sys.argv) < 3:
            print("[ERROR] Please specify video file")
            sys.exit(1)
        video_file = sys.argv[2]
        step1_transcribe(video_file)

    elif command == "translate":
        # 步骤2: 只翻译和生成SRT
        if len(sys.argv) < 3:
            print("[ERROR] Please specify output directory")
            sys.exit(1)
        output_dir = sys.argv[2]
        ollama_model = sys.argv[3] if len(sys.argv) > 3 else "qwen3:14b"
        step2_translate_and_generate_srt(output_dir, ollama_model)

    elif command == "full":
        # 完整流程
        if len(sys.argv) < 3:
            print("[ERROR] Please specify video file")
            sys.exit(1)
        video_file = sys.argv[2]
        ollama_model = sys.argv[3] if len(sys.argv) > 3 else "qwen3:14b"
        process_japanese_video(video_file, ollama_model)

    else:
        print(f"[ERROR] Unknown command: {command}")
        print("Use 'transcribe', 'translate', or 'full'")
        sys.exit(1)

