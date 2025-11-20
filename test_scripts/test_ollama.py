
import requests
import json
import sys
import os
import time

def summarize_text(file_path, model="qwen3:14b"):
    if not os.path.exists(file_path):
        print(f"[ERROR] File not found: {file_path}")
        return

    print(f"Reading text from: {file_path}")
    with open(file_path, "r", encoding="utf-8") as f:
        text_content = f.read()

    if not text_content.strip():
        print("[ERROR] File is empty")
        return

    print(f"Text length: {len(text_content)} chars")
    print(f"Sending to Ollama ({model})...")

    # 构造 Prompt
    prompt = f"""
请对以下会议录音内容进行总结。
要求：
1. 提取核心议题
2. 列出关键结论
3. 整理待办事项（如果有）
4. 保持简洁专业

内容如下：
{text_content}
"""

    start_time = time.time()

    try:
        # 调用 Ollama API
        response = requests.post(
            "http://localhost:11434/api/generate",
            json={
                "model": model,
                "prompt": prompt,
                "stream": False  # 这里为了简单，先不使用流式输出
            },
            timeout=300  # 5分钟超时，防止长文本处理时间过长
        )

        response.raise_for_status()
        result = response.json()
        summary = result['response']

        end_time = time.time()
        duration = end_time - start_time

        print("\n" + "="*20 + " 总结结果 " + "="*20)
        print(summary)
        print("="*50)
        print(f"\n[DONE] Summarization finished in {duration:.2f}s")

        # 保存总结结果
        output_file = os.path.splitext(file_path)[0] + "_summary.txt"
        with open(output_file, "w", encoding="utf-8") as f:
            f.write(summary)
        print(f"Summary saved to: {output_file}")

    except requests.exceptions.ConnectionError:
        print("[ERROR] Could not connect to Ollama. Is it running?")
        print("Run 'ollama serve' in a separate terminal.")
    except Exception as e:
        print(f"[ERROR] Failed to generate summary: {e}")

if __name__ == "__main__":
    # 默认读取刚才生成的转写文件
    transcription_file = "sample/test_transcription.txt"
    summarize_text(transcription_file)

