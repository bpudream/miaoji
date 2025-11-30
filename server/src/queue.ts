import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import db from './db';
import { AudioExtractor } from './services/audio';
import { ProjectPathService } from './services/projectPath';
import path from 'node:path';
import fs from 'node:fs';
import { getPythonWorkerPath, getPythonPath } from './utils/paths';
import { logger } from './utils/logger';

interface Task {
  id: string;
  filepath: string;
}

interface UpdateStatusExtra {
  audio_path?: string;
  error_message?: string;
  failed_stage?: string;
  duration?: number;
}

class QueueService {
  private queue: Task[] = [];
  private isProcessing = false;
  private pythonWorker: ChildProcessWithoutNullStreams | null = null;
  private pythonWorkerBuffer = '';
  private pendingWorkerRequest: { resolve: (value: any) => void; reject: (reason?: any) => void } | null = null;
  private workerRequestId = 0;

  /**
   * 添加任务到队列
   */
  add(id: string, filepath: string) {
    logger.info({ taskId: id, filepath }, 'Task added to queue');
    this.queue.push({ id, filepath });
    this.processNext();
  }

  /**
   * 更新数据库中的任务状态
   */
  private updateStatus(id: string, status: string, extra: UpdateStatusExtra = {}) {
    const updates: string[] = ['status = ?'];
    const params: any[] = [status];

    if (extra.audio_path) {
      updates.push('audio_path = ?');
      params.push(extra.audio_path);
    }
    if (extra.error_message) {
      updates.push('error_message = ?');
      params.push(extra.error_message);
    }
    if (extra.failed_stage) {
      updates.push('failed_stage = ?');
      params.push(extra.failed_stage);
    }
    if (extra.duration) {
      updates.push('duration = ?');
      params.push(extra.duration);
    }

    params.push(id);
    const sql = `UPDATE media_files SET ${updates.join(', ')} WHERE id = ?`;
    const result = db.prepare(sql).run(...params);

    logger.debug({ taskId: id, status, rowsAffected: result.changes }, 'Status updated');

    // 验证更新是否成功
    const verify = db.prepare('SELECT status FROM media_files WHERE id = ?').get(id) as any;
    logger.debug({ taskId: id, verifiedStatus: verify?.status }, 'Status verification');
  }

  /**
   * 处理下一个任务
   */
  private async processNext() {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const task = this.queue.shift();
    if (!task) {
      this.isProcessing = false;
      return;
    }

    logger.info({ taskId: task.id }, 'Processing task');
    let currentStage = 'pending';

    let audioPath: string | null = null;
    let duration = 0;

    try {
      // 1. Extracting
      currentStage = 'extracting';
      this.updateStatus(task.id, 'extracting');

      // 提取音频 (转为 16kHz WAV) 并获取时长
      // 音频会先提取到原始文件所在目录
      const extracted = await AudioExtractor.extract(task.filepath);
      let tempAudioPath = extracted.path;
      duration = extracted.duration;

      // 使用统一的路径服务获取项目ID和最终音频路径
      const projectId = task.id;
      const basePath = ProjectPathService.parseBasePathFromPath(task.filepath);

      if (!basePath) {
        throw new Error(`无法从文件路径解析存储基础路径: ${task.filepath}`);
      }

      const finalAudioPath = ProjectPathService.getAudioFilePath(basePath, projectId);

      // 如果音频文件不在项目目录，或者文件名不是 audio.wav，则移动并重命名
      if (tempAudioPath !== finalAudioPath) {
        try {
          if (fs.existsSync(tempAudioPath)) {
            // 如果目标文件已存在，先删除
            if (fs.existsSync(finalAudioPath)) {
              fs.unlinkSync(finalAudioPath);
            }
            // 移动并重命名
            fs.renameSync(tempAudioPath, finalAudioPath);
            logger.info({ taskId: task.id, audioPath: finalAudioPath }, 'Audio moved to project directory');
          }
        } catch (moveErr: any) {
          // 如果移动失败，尝试复制后删除
          logger.warn({ taskId: task.id, err: moveErr }, 'Failed to move audio file, trying copy');
          if (fs.existsSync(tempAudioPath)) {
            fs.copyFileSync(tempAudioPath, finalAudioPath);
            fs.unlinkSync(tempAudioPath);
          }
        }
      }

      audioPath = finalAudioPath;

      logger.info({ taskId: task.id, audioPath, duration: duration.toFixed(2) }, 'Audio extracted');
      try {
        const stats = fs.statSync(audioPath);
        logger.debug({ taskId: task.id, size: stats.size, modified: stats.mtime.toISOString() }, 'Audio file stats');
      } catch (statErr) {
        logger.warn({ taskId: task.id, audioPath, err: statErr }, 'Failed to stat audio file');
      }

      // 2. Transcribing
      currentStage = 'transcribing';
      this.updateStatus(task.id, 'transcribing', {
        audio_path: audioPath,
        duration: duration
      });
      logger.debug({ taskId: task.id }, "Status updated to 'transcribing'");

      // 调用 Python Worker
      const result = await this.runPythonWorker(audioPath);

      // 3. Saving Result
      const insertStmt = db.prepare(`
        INSERT INTO transcriptions (media_file_id, content, format)
        VALUES (?, ?, 'json')
      `);
      insertStmt.run(task.id, JSON.stringify(result));

      // 4. Completed
      currentStage = 'completed';
      this.updateStatus(task.id, 'completed');
      logger.info({ taskId: task.id }, 'Task completed successfully');

    } catch (error: any) {
      logger.error({ taskId: task.id, stage: currentStage, err: error }, 'Task failed');

      if (audioPath && fs.existsSync(audioPath)) {
        try {
          const diagnosticsDir = path.join(__dirname, '../diagnostics');
          fs.mkdirSync(diagnosticsDir, { recursive: true });
          const diagFilename = `${task.id}-${Date.now()}-${path.basename(audioPath)}`;
          const diagPath = path.join(diagnosticsDir, diagFilename);
          fs.copyFileSync(audioPath, diagPath);
          logger.debug({ taskId: task.id, diagPath }, 'Copied failing audio to diagnostics');
        } catch (copyErr) {
          logger.warn({ taskId: task.id, err: copyErr }, 'Failed to copy audio for diagnostics');
        }
      }

      this.updateStatus(task.id, 'error', {
        error_message: error.message,
        failed_stage: currentStage
      });
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }

  /**
   * 确保 Python Worker 在 server 模式下运行（单实例）
   */
  private ensurePythonWorker() {
    if (this.pythonWorker) return;

    const workerScript = getPythonWorkerPath();
    const pythonPath = getPythonPath();

    logger.info({ pythonPath, workerScript }, 'Starting persistent worker');
    this.pythonWorker = spawn(pythonPath, [workerScript, '--server']);
    this.pythonWorker.stdout.setEncoding('utf-8');
    this.pythonWorker.stderr.setEncoding('utf-8');
    this.pythonWorkerBuffer = '';

    this.pythonWorker.stdout.on('data', (data) => {
      this.pythonWorkerBuffer += data;
      const lines = this.pythonWorkerBuffer.split('\n');
      this.pythonWorkerBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          this.handleWorkerMessage(trimmed);
        }
      }
    });

    this.pythonWorker.stderr.on('data', (data) => {
      logger.error({ stderr: data.toString().trim() }, 'Worker stderr');
    });

    this.pythonWorker.on('close', (code) => {
      logger.error({ exitCode: code }, 'Worker exited');
      if (this.pendingWorkerRequest) {
        this.pendingWorkerRequest.reject(new Error(`Worker exited with code ${code}`));
        this.pendingWorkerRequest = null;
      }
      this.pythonWorker = null;
    });

    this.pythonWorker.on('error', (err) => {
      logger.error({ err }, 'Worker process error');
      if (this.pendingWorkerRequest) {
        this.pendingWorkerRequest.reject(err);
        this.pendingWorkerRequest = null;
      }
    });
  }

  /**
   * 运行 Python 转写进程（持久化 worker）
   */
  private runPythonWorker(audioPath: string): Promise<any> {
    this.ensurePythonWorker();

    return new Promise((resolve, reject) => {
      if (!this.pythonWorker || !this.pythonWorker.stdin.writable) {
        return reject(new Error('Python worker is not available'));
      }

      if (this.pendingWorkerRequest) {
        return reject(new Error('Python worker is busy'));
      }

      this.pendingWorkerRequest = { resolve, reject };
      const payload = JSON.stringify({
        id: ++this.workerRequestId,
        audio_file: audioPath
      });
      this.pythonWorker.stdin.write(payload + '\n');
    });
  }

  private handleWorkerMessage(line: string) {
    let message: any;
    try {
      message = JSON.parse(line);
    } catch (error) {
      logger.error({ line, err: error }, 'Failed to parse worker message');
      if (this.pendingWorkerRequest) {
        this.pendingWorkerRequest.reject(new Error('Invalid response from worker'));
        this.pendingWorkerRequest = null;
      }
      return;
    }

    if (!this.pendingWorkerRequest) {
      logger.warn({ message }, 'Received message without pending request');
      return;
    }

    const { resolve, reject } = this.pendingWorkerRequest;
    this.pendingWorkerRequest = null;

    if (message.error) {
      reject(new Error(message.error));
    } else if (message.result) {
      resolve(message.result);
    } else {
      reject(new Error('Worker returned empty result'));
    }
  }
}

export default new QueueService();
