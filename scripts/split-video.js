#!/usr/bin/env node
/**
 * 将长视频按固定时长切成多个小段，便于 E2E 测试。
 * 依赖：需已安装 ffmpeg 并加入 PATH。
 *
 * 用法：
 *   node scripts/split-video.js <视频文件路径> [选项]
 *
 * 选项：
 *   --duration=300    每段时长（秒），默认 300（5 分钟）
 *   --out-dir=<路径>  输出目录，默认与源文件同目录
 *   --prefix=<前缀>   输出文件名前缀，默认使用源文件名（不含扩展名）_part
 *
 * 示例：
 *   node scripts/split-video.js D:\videos\long.mp4
 *   node scripts/split-video.js D:\videos\long.mp4 --duration=180 --out-dir=./clips
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const inputFile = args.find(a => !a.startsWith('--'));
const durationArg = args.find(a => a.startsWith('--duration='));
const outDirArg = args.find(a => a.startsWith('--out-dir='));
const prefixArg = args.find(a => a.startsWith('--prefix='));

const segmentDuration = durationArg ? parseInt(durationArg.split('=')[1], 10) : 300;
const outDir = outDirArg ? path.resolve(outDirArg.split('=')[1]) : null;
const customPrefix = prefixArg ? prefixArg.split('=')[1] : null;

if (!inputFile || !fs.existsSync(inputFile)) {
  console.error('用法: node scripts/split-video.js <视频文件路径> [--duration=300] [--out-dir=<目录>] [--prefix=<前缀>]');
  console.error('请提供存在的视频文件路径。');
  process.exit(1);
}

const inputPath = path.resolve(inputFile);
const baseName = path.basename(inputPath, path.extname(inputPath));
const targetDir = outDir || path.dirname(inputPath);
const prefix = customPrefix !== null ? customPrefix : `${baseName}_part`;
const outputPattern = path.join(targetDir, `${prefix}%03d${path.extname(inputPath)}`);

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
  console.log('已创建输出目录:', targetDir);
}

console.log('输入:', inputPath);
console.log('每段时长:', segmentDuration, '秒');
console.log('输出目录:', targetDir);
console.log('输出命名:', `${prefix}000${path.extname(inputPath)}, ${prefix}001..., ...`);
console.log('');

const ffmpeg = spawn(
  'ffmpeg',
  [
    '-i', inputPath,
    '-map', '0',
    '-c', 'copy',
    '-f', 'segment',
    '-segment_time', String(segmentDuration),
    '-reset_timestamps', '1',
    '-y',
    outputPattern
  ],
  { stdio: 'inherit', shell: true }
);

ffmpeg.on('error', (err) => {
  console.error('无法启动 ffmpeg，请确认已安装并加入 PATH:', err.message);
  process.exit(1);
});

ffmpeg.on('close', (code) => {
  if (code === 0) {
    const files = fs.readdirSync(targetDir).filter(f => f.startsWith(prefix) && f.endsWith(path.extname(inputPath)));
    console.log('\n完成，共生成', files.length, '个片段:');
    files.forEach(f => console.log('  ', path.join(targetDir, f)));
  } else {
    console.error('ffmpeg 退出码:', code);
    process.exit(code);
  }
});
