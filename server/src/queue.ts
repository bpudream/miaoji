import { spawn } from 'node:child_process';
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

    try {
      // 1. Extracting
      currentStage = 'extracting';
      this.updateStatus(task.id, 'extracting');

      // 提取音频 (转为 16kHz WAV) 并获取时长
      const { path: audioPath, duration } = await AudioExtractor.extract(task.filepath);

      console.log(`[Queue] Audio extracted: ${audioPath} (Duration: ${duration.toFixed(2)}s)`);

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
   * 运行 Python 转写进程
   */
  private runPythonWorker(audioPath: string): Promise<any> {
    return new Promise((resolve, reject) => {
      const workerScript = path.join(__dirname, '../python/worker.py');
      const venvPython = path.join(__dirname, '../../venv/Scripts/python.exe');

      console.log(`[Queue] Spawning worker: ${venvPython} ${workerScript}`);
      const pythonProcess = spawn(venvPython, [workerScript, audioPath]);

      let stdoutData = '';
      let stderrData = '';

      // 设置 stdout 编码，防止乱码 (虽然 python 脚本里也设了 utf-8)
      pythonProcess.stdout.setEncoding('utf-8');
      pythonProcess.stderr.setEncoding('utf-8');

      pythonProcess.stdout.on('data', (data) => {
        stdoutData += data;
      });

      pythonProcess.stderr.on('data', (data) => {
        stderrData += data;
        // 可以在这里解析实时进度，例如 tqdm 的输出
        // if (data.includes('%')) ...
      });

      pythonProcess.on('close', (code) => {
        if (code !== 0) {
          console.error(`[Worker Error] Stderr: ${stderrData}`);
          return reject(new Error(`Worker exited with code ${code}. Check logs.`));
        }

        try {
          // 找到最后一行有效的 JSON (为了容错，防止有 print 日志混入)
          const lines = stdoutData.trim().split('\n').filter(line => line.trim());
          if (lines.length === 0) {
            return reject(new Error('No output from worker'));
          }
          const lastLine = lines[lines.length - 1];
          if (!lastLine) {
            return reject(new Error('Empty output from worker'));
          }
          const result = JSON.parse(lastLine);

          if (result.error) {
            reject(new Error(result.error));
          } else {
            resolve(result);
          }
        } catch (e) {
          console.error(`[Worker Error] Failed to parse JSON. Output: ${stdoutData}`);
          reject(new Error(`Failed to parse JSON output from worker.`));
        }
      });

      pythonProcess.on('error', (err) => reject(err));
    });
  }
}

export default new QueueService();
