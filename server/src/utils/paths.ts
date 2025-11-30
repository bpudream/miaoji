import path from 'node:path';
import fs from 'node:fs';

/**
 * 获取项目根目录（server 目录）
 * 在编译后的代码中，__dirname 指向 dist/ 或 dist/子目录
 * 在开发环境中，__dirname 指向 src/ 或 src/子目录
 * 需要向上查找找到 server 目录
 */
export function getServerRoot(): string {
  const currentDir = __dirname;
  const normalizedDir = path.normalize(currentDir);

  // 检查是否在 dist 目录中（编译后的代码）
  // 例如: C:\Users\...\server\dist\utils 或 C:\Users\...\server\dist\services
  const distMatch = normalizedDir.match(/^(.*[\\/])server[\\/]dist[\\/]/);
  if (distMatch && distMatch[1]) {
    return path.join(distMatch[1], 'server');
  }

  // 检查是否在 src 目录中（开发环境）
  // 例如: C:\Users\...\server\src\utils 或 C:\Users\...\server\src\services
  const srcMatch = normalizedDir.match(/^(.*[\\/])server[\\/]src[\\/]/);
  if (srcMatch && srcMatch[1]) {
    return path.join(srcMatch[1], 'server');
  }

  // 如果都不匹配，尝试向上查找直到找到包含 package.json 的目录
  let searchDir = currentDir;
  for (let i = 0; i < 5; i++) {
    const packageJsonPath = path.join(searchDir, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      return searchDir;
    }
    searchDir = path.resolve(searchDir, '..');
  }

  // 最后的后备方案：假设当前目录的上一级是 server 目录
  return path.resolve(currentDir, '..');
}

/**
 * 获取 Python Worker 脚本路径
 * 优先使用环境变量 PYTHON_WORKER_PATH，否则使用默认路径
 */
export function getPythonWorkerPath(): string {
  const envPath = process.env.PYTHON_WORKER_PATH;
  if (envPath) {
    // 如果是绝对路径，直接使用
    if (path.isAbsolute(envPath)) {
      return envPath;
    }
    // 如果是相对路径，相对于 server 目录
    return path.resolve(getServerRoot(), envPath);
  }

  // 默认路径：server/python/worker.py
  return path.join(getServerRoot(), 'python', 'worker.py');
}

/**
 * 获取 Python 可执行文件路径
 * 优先使用环境变量 PYTHON_PATH，否则尝试查找虚拟环境或系统 Python
 */
export function getPythonPath(): string {
  const envPath = process.env.PYTHON_PATH;
  if (envPath) {
    return envPath;
  }

  // 尝试虚拟环境路径
  const serverRoot = getServerRoot();
  const venvPython = path.join(serverRoot, '..', 'venv', 'Scripts', 'python.exe');
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }

  // 回退到系统 Python
  return 'python';
}

/**
 * 获取模型文件路径
 * 优先使用环境变量 MODEL_PATH，否则使用默认路径
 *
 * 注意：MODEL_PATH 如果是相对路径，应该是相对于 server 目录的路径
 * 例如：../models/large-v3 表示 server 目录的上一级的 models/large-v3
 */
export function getModelPath(): string {
  const envPath = process.env.MODEL_PATH;
  if (envPath) {
    if (path.isAbsolute(envPath)) {
      return envPath;
    }
    // 如果是相对路径，相对于 server 目录解析
    // 例如：../models/large-v3 会解析为 server目录/../models/large-v3
    return path.resolve(getServerRoot(), envPath);
  }

  // 默认路径：项目根目录/models/large-v3
  return path.join(getServerRoot(), '..', 'models', 'large-v3');
}

