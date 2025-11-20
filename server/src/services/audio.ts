import ffmpeg from 'fluent-ffmpeg';
import path from 'node:path';
import fs from 'node:fs';

// 确保 ffmpeg 在环境变量中，或者显式指定路径
// 如果在 Windows 上且未添加到 PATH，可能需要:
// ffmpeg.setFfmpegPath('C:\\path\\to\\ffmpeg.exe');

export class AudioExtractor {
  /**
   * 获取媒体文件时长 (秒)
   */
  static getDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          console.error(`[Audio] Error probing file: ${err.message}`);
          // 如果探测失败，返回 0，不阻断流程
          return resolve(0);
        }
        resolve(metadata.format.duration || 0);
      });
    });
  }

  /**
   * 提取音频并转换为 16kHz 单声道 WAV (Whisper 最佳格式)
   * @returns { path: string, duration: number }
   */
  static async extract(inputPath: string, outputDir: string = path.dirname(inputPath)): Promise<{ path: string, duration: number }> {
    const fileName = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(outputDir, `${fileName}_16k.wav`);

    // 获取时长 (使用 ffprobe 探测源文件，比文件大小估算更准，且适用于所有格式)
    // 注意：我们探测的是源文件，通常源文件时长和提取后的音频时长是一致的
    const duration = await AudioExtractor.getDuration(inputPath);

    // 如果已存在且大小 > 0，直接返回
    if (fs.existsSync(outputPath)) {
      const stats = fs.statSync(outputPath);
      if (stats.size > 0) {
        console.log(`[Audio] Cached audio found: ${outputPath} (Duration: ${duration}s)`);
        return { path: outputPath, duration };
      }
    }

    console.log(`[Audio] Extracting audio from ${inputPath} to ${outputPath}`);

    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .toFormat('wav')
        .audioFrequency(16000) // 16kHz for Whisper
        .audioChannels(1)      // Mono
        .on('end', () => {
          console.log(`[Audio] Extraction completed`);
          resolve({ path: outputPath, duration });
        })
        .on('error', (err) => {
          console.error(`[Audio] Error extracting: ${err.message}`);
          reject(err);
        })
        .save(outputPath);
    });
  }
}

