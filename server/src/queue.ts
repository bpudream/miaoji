import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import db from './db';
import { AudioExtractor } from './services/audio';

interface Task {
  id: number;
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
  add(id: number, filepath: string) {
    console.log(`[Queue] Task added: File ID ${id}`);
    this.queue.push({ id, filepath });
    this.processNext();
  }

  /**
   * 更新数据库中的任务状态
   */
  private updateStatus(id: number, status: string, extra: UpdateStatusExtra = {}) {
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

    console.log(`[Queue] Status updated for File ID ${id}: ${status} (rows affected: ${result.changes})`);

    // 验证更新是否成功
    const verify = db.prepare('SELECT status FROM media_files WHERE id = ?').get(id) as any;
    console.log(`[Queue] Verification - DB status for File ID ${id}: ${verify?.status}`);
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

    console.log(`[Queue] Processing File ID ${task.id}...`);
    let currentStage = 'pending';

    let audioPath: string | null = null;
    let duration = 0;

    try {
      // 1. Extracting
      currentStage = 'extracting';
      this.updateStatus(task.id, 'extracting');

      // 提取音频 (转为 16kHz WAV) 并获取时长
      const extracted = await AudioExtractor.extract(task.filepath);
      audioPath = extracted.path;
      duration = extracted.duration;

      console.log(`[Queue] Audio extracted: ${audioPath} (Duration: ${duration.toFixed(2)}s)`);
      try {
        const stats = fs.statSync(audioPath);
        console.log(`[Queue][Diag] Audio file size: ${stats.size} bytes, modified: ${stats.mtime.toISOString()}`);
      } catch (statErr) {
        console.warn(`[Queue][Diag] Failed to stat audio file ${audioPath}: ${(statErr as Error).message}`);
      }

      // 2. Transcribing
      currentStage = 'transcribing';
      this.updateStatus(task.id, 'transcribing', {
        audio_path: audioPath,
        duration: duration
      });
      console.log(`[Queue] Status updated to 'transcribing' for File ID ${task.id}`);

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
      console.log(`[Queue] Task ${task.id} completed successfully. Status updated to 'completed'.`);

    } catch (error: any) {
      console.error(`[Queue] Task ${task.id} failed at ${currentStage}:`, error.message);

      if (audioPath && fs.existsSync(audioPath)) {
        try {
          const diagnosticsDir = path.join(__dirname, '../diagnostics');
          fs.mkdirSync(diagnosticsDir, { recursive: true });
          const diagFilename = `${task.id}-${Date.now()}-${path.basename(audioPath)}`;
          const diagPath = path.join(diagnosticsDir, diagFilename);
          fs.copyFileSync(audioPath, diagPath);
          console.log(`[Queue][Diag] Copied failing audio to ${diagPath}`);
        } catch (copyErr) {
          console.warn(`[Queue][Diag] Failed to copy audio for diagnostics: ${(copyErr as Error).message}`);
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

    const workerScript = path.join(__dirname, '../python/worker.py');
    const venvPython = path.join(__dirname, '../../venv/Scripts/python.exe');

    console.log(`[Queue] Starting persistent worker: ${venvPython} ${workerScript} --server`);
    this.pythonWorker = spawn(venvPython, [workerScript, '--server']);
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
      console.error(`[Worker][stderr] ${data}`);
    });

    this.pythonWorker.on('close', (code) => {
      console.error(`[Worker] exited with code ${code}`);
      if (this.pendingWorkerRequest) {
        this.pendingWorkerRequest.reject(new Error(`Worker exited with code ${code}`));
        this.pendingWorkerRequest = null;
      }
      this.pythonWorker = null;
    });

    this.pythonWorker.on('error', (err) => {
      console.error(`[Worker] process error: ${err.message}`);
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
      console.error('[Worker] Failed to parse message:', line);
      if (this.pendingWorkerRequest) {
        this.pendingWorkerRequest.reject(new Error('Invalid response from worker'));
        this.pendingWorkerRequest = null;
      }
      return;
    }

    if (!this.pendingWorkerRequest) {
      console.warn('[Worker] Received message without pending request:', message);
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
