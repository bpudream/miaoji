
import time
import sys
from faster_whisper import WhisperModel

def test_cuda():
    print("Checking CUDA availability...")

    try:
        # 尝试加载 tiny 模型到 GPU
        # compute_type="int8" 是较快的量化模式
        start_time = time.time()
        model = WhisperModel("tiny", device="cuda", compute_type="int8")
        end_time = time.time()

        print(f"[SUCCESS] Loaded model to CUDA! Time: {end_time - start_time:.2f}s")
        return True

    except Exception as e:
        print(f"[ERROR] Load failed: {e}")
        print("\nPossible reasons:")
        print("1. CUDA/cuDNN not installed or path not set")
        print("2. Incompatible PyTorch version")
        print("3. GPU not supported")
        return False

if __name__ == "__main__":
    if test_cuda():
        sys.exit(0)
    else:
        sys.exit(1)
