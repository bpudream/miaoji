import os
import sys
import time
import pathlib
import subprocess
from faster_whisper import WhisperModel

# 强制 stdout 使用 utf-8（避免 Windows GBK 编码问题）
if sys.platform == 'win32':
    sys.stdout.reconfigure(encoding='utf-8')

# 获取项目根目录（脚本在 test_scripts/ 下，向上到项目根）
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)  # 从 test_scripts/ 到项目根

# 切换到项目根目录（与其他测试脚本保持一致）
os.chdir(PROJECT_ROOT)

# 配置 - 使用相对路径（相对于项目根目录，与其他测试脚本一致）
MODEL_PATH = "models/large-v3"

# 可以传入命令行参数，或者直接修改这里
TEST_FILE = None
if len(sys.argv) > 1:
    # 传入的路径相对于项目根目录
    TEST_FILE = sys.argv[1]
else:
    # 默认尝试几个可能的位置（相对于项目根目录）
    possible_paths = [
        "sample/test_crash.mp4",  # 用户指定的测试文件
        "server/uploads/1763643742247-SVID_20240425_221501_2_16k.wav",
        "server/uploads/1763643742247-SVID_20240425_221501_2.mp4",
        "1763643742247-SVID_20240425_221501_2_16k.wav",
        "1763643742247-SVID_20240425_221501_2.mp4",
    ]
    for path in possible_paths:
        if os.path.exists(path):
            TEST_FILE = path
            break

def test_transcribe():
    print("--- Starting Crash Test ---")
    print(f"Target File: {TEST_FILE}")
    print(f"Model Path: {MODEL_PATH}")

    if not TEST_FILE:
        print("ERROR: File not specified.")
        print("\nUsage: python test_crash_file.py <file_path>")
        print("\nAvailable files in server/uploads/:")
        uploads_dir = "server/uploads"
        if os.path.exists(uploads_dir):
            files = os.listdir(uploads_dir)
            if files:
                for f in files:
                    print(f"  - {os.path.join(uploads_dir, f)}")
            else:
                print("  (directory is empty)")
        else:
            print(f"  (directory not found: {uploads_dir})")
        print("\nExample:")
        print("  python test_crash_file.py server/uploads/your_file.wav")
        return

    if not os.path.exists(TEST_FILE):
        print(f"ERROR: File not found: {TEST_FILE}")
        # 尝试找一下原始 mp4
        if TEST_FILE.endswith("_16k.wav"):
            mp4_path = TEST_FILE.replace("_16k.wav", ".mp4")
            if os.path.exists(mp4_path):
                print(f"WARNING: Found MP4 instead: {mp4_path}, using it.")
                target_file = mp4_path
            else:
                print(f"\nPlease check the file path. Current working directory: {os.getcwd()}")
                print("Available files in server/uploads/:")
                uploads_dir = "server/uploads"
                if os.path.exists(uploads_dir):
                    files = os.listdir(uploads_dir)
                    for f in files:
                        print(f"  - {os.path.join(uploads_dir, f)}")
                return
        else:
            print(f"\nCurrent working directory: {os.getcwd()}")
            return
    else:
        target_file = TEST_FILE

    # 如果是视频文件，先提取音频（模拟生产环境）
    file_ext = pathlib.Path(target_file).suffix.lower()
    if file_ext in ['.mp4', '.mov', '.avi', '.mkv', '.webm']:
        print(f"\nNOTE: Input is a video file ({file_ext}).")
        print("Extracting audio first (to match production workflow)...")

        # 生成输出路径（与生产环境一致：文件名_16k.wav）
        input_path = pathlib.Path(target_file)
        output_dir = input_path.parent
        output_path = output_dir / f"{input_path.stem}_16k.wav"

        # 如果已存在，直接使用
        if output_path.exists() and output_path.stat().st_size > 0:
            print(f"OK: Using existing audio file: {output_path}")
            target_file = str(output_path)
        else:
            try:
                extract_start = time.time()
                # 使用 ffmpeg 提取音频（与生产环境一致）
                # ffmpeg -i input.mp4 -ar 16000 -ac 1 output.wav
                cmd = [
                    'ffmpeg',
                    '-i', target_file,
                    '-ar', '16000',  # 16kHz
                    '-ac', '1',      # Mono
                    '-y',            # 覆盖已存在文件
                    str(output_path)
                ]
                print(f"Running: {' '.join(cmd)}")
                result = subprocess.run(cmd, capture_output=True, text=True, check=True)
                print(f"OK: Audio extracted to {output_path} in {time.time() - extract_start:.2f}s")
                target_file = str(output_path)
            except subprocess.CalledProcessError as e:
                print(f"WARNING: Audio extraction failed: {e.stderr}")
                print("Will try to transcribe video directly (faster-whisper may handle it)...")
            except FileNotFoundError:
                print("WARNING: ffmpeg not found in PATH. Testing video directly.")
                print("(faster-whisper can handle video, but this doesn't match production workflow)")

    if not os.path.exists(MODEL_PATH):
        print(f"ERROR: Model not found: {MODEL_PATH}")
        return

    try:
        print("1. Loading Model (Device: CUDA, Compute: int8)...")
        print("   (To test CPU, modify device='cpu' in the script)")
        start_load = time.time()
        # 如果你想测试 CPU，请修改 device="cpu", compute_type="int8"
        model = WhisperModel(MODEL_PATH, device="cuda", compute_type="int8")
        print(f"OK: Model loaded in {time.time() - start_load:.2f}s")

        print("2. Starting Transcription...")
        start_trans = time.time()

        segments, info = model.transcribe(
            target_file,
            beam_size=5,
            language="zh",
            vad_filter=True
        )

        print(f"INFO: Detected Language: {info.language} (Prob: {info.language_probability:.2f})")
        print(f"INFO: Duration: {info.duration:.2f}s")

        print("3. Iterating segments (This is where it usually crashes if OOM)...")

        count = 0
        for segment in segments:
            count += 1
            print(f"   [{segment.start:.2f}s -> {segment.end:.2f}s] {segment.text}")
            sys.stdout.flush() # 强制刷新缓冲区，确保崩溃前能看到日志

        print(f"OK: Transcription Completed! Total Segments: {count}")
        print(f"TIME: Total Time: {time.time() - start_trans:.2f}s")

    except Exception as e:
        print(f"\nERROR: Python Exception Caught: {e}")
        import traceback
        traceback.print_exc()

    print("--- Test Finished ---")

if __name__ == "__main__":
    test_transcribe()

