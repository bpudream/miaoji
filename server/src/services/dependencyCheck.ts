import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { ollamaService } from './ollama';
import { getPythonWorkerPath, getPythonPath, getModelPath, getServerRoot } from '../utils/paths';

interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
}

export class DependencyChecker {
  /**
   * 检查所有依赖
   */
  static async checkAll(): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    // 检查 Python 环境
    results.push(await this.checkPython());

    // 检查 Python 依赖
    results.push(await this.checkPythonDependencies());

    // 检查 Python Worker 脚本
    results.push(await this.checkPythonWorker());

    // 检查 FFmpeg
    results.push(await this.checkFFmpeg());

    // 检查 Ollama 服务
    results.push(await this.checkOllama());

    // 检查模型文件
    results.push(await this.checkModelFiles());

    // 检查必要的目录
    results.push(await this.checkDirectories());

    return results;
  }

  /**
   * 检查 Python 环境
   */
  private static async checkPython(): Promise<CheckResult> {
    return new Promise((resolve) => {
      const pythonPath = getPythonPath();

      const process = spawn(pythonPath, ['--version']);
      let output = '';

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        output += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          const version = output.trim();
          const source = pythonPath.includes('venv') ? 'Virtual environment' :
                        pythonPath === 'python' ? 'System' : 'Custom';
          resolve({
            name: 'Python',
            status: 'ok',
            message: `${source} Python found: ${version} (${pythonPath})`
          });
        } else {
          resolve({
            name: 'Python',
            status: 'error',
            message: `Python not found at: ${pythonPath}. Please install Python 3.10+ or configure PYTHON_PATH in .env`
          });
        }
      });

      process.on('error', () => {
        resolve({
          name: 'Python',
          status: 'error',
          message: `Python not found at: ${pythonPath}. Please install Python 3.10+ or configure PYTHON_PATH in .env`
        });
      });
    });
  }

  /**
   * 检查 Python 依赖（faster-whisper）
   */
  private static async checkPythonDependencies(): Promise<CheckResult> {
    return new Promise((resolve) => {
      const pythonPath = getPythonPath();

      const process = spawn(pythonPath, ['-c', 'import faster_whisper; print("OK")']);
      let output = '';
      let errorOutput = '';

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.stderr.on('data', (data) => {
        errorOutput += data.toString();
        output += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0 && output.includes('OK')) {
          resolve({
            name: 'Python Dependencies',
            status: 'ok',
            message: `faster-whisper is installed (using: ${pythonPath})`
          });
        } else {
          // 提取错误信息的关键部分
          let errorMsg = 'faster-whisper is not installed';
          if (errorOutput.includes('ModuleNotFoundError') || errorOutput.includes('No module named')) {
            errorMsg = 'faster-whisper is not installed in this Python environment';
          }

          // 检查是否是虚拟环境路径问题
          const serverRoot = getServerRoot();
          const venvPython = path.join(serverRoot, '..', 'venv', 'Scripts', 'python.exe');
          const venvExists = fs.existsSync(venvPython);

          // 如果路径中有空格，需要用引号包裹
          const quotedPythonPath = pythonPath.includes(' ') ? `"${pythonPath}"` : pythonPath;
          let installHint = `Run: ${quotedPythonPath} -m pip install faster-whisper`;
          if (venvExists && pythonPath !== venvPython) {
            const quotedVenvPath = venvPython.includes(' ') ? `"${venvPython}"` : venvPython;
            installHint += `\n   Note: Virtual environment found at ${quotedVenvPath}, but using ${quotedPythonPath}. Consider setting PYTHON_PATH in .env`;
          }

          resolve({
            name: 'Python Dependencies',
            status: 'error',
            message: `${errorMsg}. ${installHint}`
          });
        }
      });

      process.on('error', (err) => {
        resolve({
          name: 'Python Dependencies',
          status: 'error',
          message: `Cannot check Python dependencies: ${err.message} (tried: ${pythonPath})`
        });
      });
    });
  }

  /**
   * 检查 Python Worker 脚本
   */
  private static checkPythonWorker(): CheckResult {
    const workerScript = getPythonWorkerPath();

    if (fs.existsSync(workerScript)) {
      return {
        name: 'Python Worker',
        status: 'ok',
        message: `Worker script found: ${workerScript}`
      };
    } else {
      return {
        name: 'Python Worker',
        status: 'error',
        message: `Worker script not found: ${workerScript}. Please configure PYTHON_WORKER_PATH in .env`
      };
    }
  }

  /**
   * 检查 FFmpeg
   */
  private static async checkFFmpeg(): Promise<CheckResult> {
    return new Promise((resolve) => {
      const process = spawn('ffmpeg', ['-version']);
      let output = '';

      process.stdout.on('data', (data) => {
        output += data.toString();
      });

      process.on('close', (code) => {
        if (code === 0) {
          // 提取版本信息
          const versionMatch = output.match(/ffmpeg version (\S+)/);
          const version = versionMatch ? versionMatch[1] : 'unknown';
          resolve({
            name: 'FFmpeg',
            status: 'ok',
            message: `FFmpeg found (version: ${version})`
          });
        } else {
          resolve({
            name: 'FFmpeg',
            status: 'error',
            message: 'FFmpeg not found. Please install FFmpeg and add it to PATH.'
          });
        }
      });

      process.on('error', () => {
        resolve({
          name: 'FFmpeg',
          status: 'error',
          message: 'FFmpeg not found. Please install FFmpeg and add it to PATH.'
        });
      });
    });
  }

  /**
   * 检查 Ollama 服务
   */
  private static async checkOllama(): Promise<CheckResult> {
    try {
      const isRunning = await ollamaService.ensureRunning();
      if (isRunning) {
        return {
          name: 'Ollama',
          status: 'ok',
          message: 'Ollama service is running'
        };
      } else {
        return {
          name: 'Ollama',
          status: 'warning',
          message: 'Ollama service is not running. Summary feature will not work. Start Ollama service to enable AI summaries.'
        };
      }
    } catch (error: any) {
      return {
        name: 'Ollama',
        status: 'warning',
        message: `Cannot connect to Ollama: ${error.message}. Summary feature will not work.`
      };
    }
  }

  /**
   * 检查模型文件
   */
  private static checkModelFiles(): CheckResult {
    const modelDir = getModelPath();
    const requiredFiles = ['model.bin', 'config.json', 'tokenizer.json'];
    const missingFiles: string[] = [];

    for (const file of requiredFiles) {
      const filePath = path.join(modelDir, file);
      if (!fs.existsSync(filePath)) {
        missingFiles.push(file);
      }
    }

    if (missingFiles.length === 0) {
      return {
        name: 'Whisper Model',
        status: 'ok',
        message: `Model files found: ${modelDir}`
      };
    } else {
      return {
        name: 'Whisper Model',
        status: 'error',
        message: `Missing model files: ${missingFiles.join(', ')}. Please download the model to ${modelDir} or configure MODEL_PATH in .env`
      };
    }
  }

  /**
   * 检查必要的目录
   * 注意：这些目录会在运行时自动创建，所以即使不存在也不应该标记为警告
   */
  private static checkDirectories(): CheckResult {
    const baseDir = __dirname;
    const requiredDirs = [
      path.join(baseDir, '../data'),
      path.join(baseDir, '../uploads')
    ];

    const missingDirs: string[] = [];
    for (const dir of requiredDirs) {
      if (!fs.existsSync(dir)) {
        missingDirs.push(path.basename(dir));
      }
    }

    if (missingDirs.length === 0) {
      return {
        name: 'Directories',
        status: 'ok',
        message: 'Required directories exist'
      };
    } else {
      // 目录不存在不是问题，会在运行时自动创建，所以返回 ok 状态
      return {
        name: 'Directories',
        status: 'ok',
        message: `Directories will be created automatically if needed: ${missingDirs.join(', ')}`
      };
    }
  }

  /**
   * 打印检查结果
   */
  static printResults(results: CheckResult[]): void {
    console.log('\n========================================');
    console.log('Dependency Check Results');
    console.log('========================================\n');

    // 显示路径配置信息
    console.log('📁 Path Configuration:');
    console.log(`   Server Root: ${getServerRoot()}`);
    console.log(`   Python Worker: ${getPythonWorkerPath()}`);
    console.log(`   Python Executable: ${getPythonPath()}`);
    console.log(`   Whisper Model: ${getModelPath()}`);
    console.log('');

    let hasError = false;
    let hasWarning = false;

    for (const result of results) {
      const icon = result.status === 'ok' ? '✓' : result.status === 'warning' ? '⚠' : '✗';
      const color = result.status === 'ok' ? '\x1b[32m' : result.status === 'warning' ? '\x1b[33m' : '\x1b[31m';
      const reset = '\x1b[0m';

      console.log(`${color}${icon}${reset} ${result.name}: ${result.message}`);

      if (result.status === 'error') {
        hasError = true;
      } else if (result.status === 'warning') {
        // Directories 的警告不应该计入，因为会自动创建
        if (result.name !== 'Directories') {
          hasWarning = true;
        }
      }
    }

    console.log('\n========================================\n');

    if (hasError) {
      console.log('⚠️  Some critical dependencies are missing. The service may not work properly.');
      console.log('Please install the missing dependencies before using the service.\n');
    } else if (hasWarning) {
      console.log('⚠️  Some optional dependencies are missing. Some features may not work.');
      console.log('The service will start, but some features may be unavailable.\n');
    } else {
      console.log('✓ All dependencies are available. Service is ready to start.\n');
    }
  }

  /**
   * 检查是否有致命错误
   * 注意：Directories 检查即使返回 warning 也不应该计入致命错误（因为会自动创建）
   */
  static hasCriticalErrors(results: CheckResult[]): boolean {
    return results.some(r => r.status === 'error' &&
      (r.name === 'Python' || r.name === 'Python Dependencies' || r.name === 'Python Worker' || r.name === 'FFmpeg'));
  }

  /**
   * 检查是否有警告（不包括会自动创建的目录）
   */
  static hasWarnings(results: CheckResult[]): boolean {
    return results.some(r => r.status === 'warning' && r.name !== 'Directories');
  }
}

