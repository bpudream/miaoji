import { spawn } from 'node:child_process';
import path from 'node:path';
import db from './db';

interface Task {
  id: number;
  filepath: string;
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
   * 处理下一个任务
   */
  private async processNext() {
    // 如果正在处理或队列为空，则直接返回
    if (this.isProcessing || this.queue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const task = this.queue.shift();
    if (!task) {
      this.isProcessing = false;
      return;
    }

    console.log(`[Queue] Processing File ID ${task.id}...`);

    try {
      // 1. 更新状态为 processing
      db.prepare('UPDATE media_files SET status = ? WHERE id = ?').run('processing', task.id);

      // 2. 定位 Python 脚本
      // 假设 server/src/queue.ts -> server/python/worker.py
      const workerScript = path.join(__dirname, '../python/worker.py');

      // 3. 定位 Python 解释器 (使用 venv)
      // 假设 venv 在项目根目录: server/src/../../venv/Scripts/python.exe
      const venvPython = path.join(__dirname, '../../venv/Scripts/python.exe');

      console.log(`[Queue] Spawning worker with: ${venvPython} ${workerScript}`);

      // 3. 启动 Python 进程
      const pythonProcess = spawn(venvPython, [workerScript, task.filepath]);

      let stdoutData = '';
      let stderrData = '';

      pythonProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
      });

      pythonProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        stderrData += msg;
        // 某些库可能会输出 info 到 stderr，不一定是错误，但记录下来方便调试
        console.log(`[Worker Log]: ${msg}`);
      });

      // 等待进程结束
      await new Promise<void>((resolve, reject) => {
        pythonProcess.on('close', (code) => {
          if (code === 0) {
            resolve();
          } else {
            reject(new Error(`Worker exited with code ${code}`));
          }
        });
        pythonProcess.on('error', (err) => {
          reject(err);
        });
      });

      // 4. 解析结果
      console.log('[Queue] Worker finished. Parsing result...');
      let result;
      try {
        result = JSON.parse(stdoutData.trim());
      } catch (e) {
        throw new Error(`Failed to parse JSON output: ${stdoutData} | Stderr: ${stderrData}`);
      }

      if (result.error) {
        throw new Error(result.error);
      }

      // 5. 保存转写结果
      const insertStmt = db.prepare(`
        INSERT INTO transcriptions (media_file_id, content, format)
        VALUES (?, ?, 'json')
      `);
      insertStmt.run(task.id, JSON.stringify(result));

      // 6. 更新状态为 completed
      db.prepare('UPDATE media_files SET status = ? WHERE id = ?').run('completed', task.id);
      console.log(`[Queue] Task ${task.id} completed successfully.`);

    } catch (error: any) {
      console.error(`[Queue] Task ${task.id} failed:`, error.message);
      // 记录错误状态
      db.prepare('UPDATE media_files SET status = ? WHERE id = ?').run('error', task.id);
    } finally {
      // 无论成功失败，都尝试处理下一个
      this.isProcessing = false;
      this.processNext();
    }
  }
}

// 导出单例
export default new QueueService();

