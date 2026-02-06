import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import db from './db';
import { AudioExtractor } from './services/audio';
import { ProjectPathService } from './services/projectPath';
import path from 'node:path';
import fs from 'node:fs';
import { getPythonWorkerPath, getPythonPath } from './utils/paths';
import { logger } from './utils/logger';
import { runTranslation } from './services/translation';
import {
  getPromptConfigForScenario,
  buildPrompt,
  normalizeScenario,
  type ScenarioKey
} from './services/whisperPrompt';

type TaskType = 'transcribe' | 'burn_subtitle' | 'translate';

interface TranscribePayload {
  id: string;
  filepath: string;
}

type TaskPayloadMap = {
  transcribe: TranscribePayload;
  burn_subtitle: { id: string };
  translate: { id: string; target_language?: string };
};

interface Task<T extends TaskType = TaskType> {
  type: T;
  payload: TaskPayloadMap[T];
}

interface UpdateStatusExtra {
  audio_path?: string;
  error_message?: string;
  failed_stage?: string;
  duration?: number;
  transcription_progress?: number | null;
}

interface WorkerOptions {
  initial_prompt?: string;
  task?: 'transcribe' | 'translate';
  language?: string | null;
  condition_on_previous_text?: boolean;
  compression_ratio_threshold?: number;
}

class QueueService {
  private queue: Task[] = [];
  private isProcessing = false;
  private pythonWorker: ChildProcessWithoutNullStreams | null = null;
  private pythonWorkerBuffer = '';
  private pendingWorkerRequest: {
    resolve: (value: any) => void;
    reject: (reason?: any) => void;
    taskId: string;
  } | null = null;
  private workerRequestId = 0;
  /** 进度写库节流：上次写入的进度与时间 */
  private progressThrottleLastPct = 0;
  private progressThrottleLastTs = 0;
  private handlers: Partial<{ [K in TaskType]: (payload: TaskPayloadMap[K]) => Promise<void> }> = {};

  constructor() {
    this.registerHandler('transcribe', this.handleTranscribe.bind(this));
    this.registerHandler('translate', this.handleTranslate.bind(this));
  }

  /**
   * 添加任务到队列
   */
  add<T extends TaskType>(type: T, payload: TaskPayloadMap[T]) {
    logger.info({ type, payload }, 'Task added to queue');
    this.queue.push({ type, payload });
    this.processNext();
  }

  registerHandler<T extends TaskType>(type: T, handler: (payload: TaskPayloadMap[T]) => Promise<void>) {
    this.handlers[type] = handler as (payload: TaskPayloadMap[TaskType]) => Promise<void>;
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
    if (extra.transcription_progress !== undefined) {
      updates.push('transcription_progress = ?');
      params.push(extra.transcription_progress);
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

    const handler = this.handlers[task.type];
    if (!handler) {
      logger.error({ type: task.type }, 'No handler registered for task type');
      this.isProcessing = false;
      this.processNext();
      return;
    }

    logger.info({ type: task.type }, 'Processing task');

    try {
      await handler(task.payload as never);
    } catch (error: any) {
      logger.error({ type: task.type, err: error }, 'Task handler failed');
    } finally {
      this.isProcessing = false;
      this.processNext();
    }
  }

  private async handleTranscribe(payload: TranscribePayload) {
    const taskId = payload.id;
    const filepath = payload.filepath;
    let currentStage = 'pending';
    let audioPath: string | null = null;
    let duration = 0;
    const fileInfo = db
      .prepare(
        'SELECT scenario, transcribe_meta, original_name, display_name FROM media_files WHERE id = ?'
      )
      .get(taskId) as
      | { scenario?: string; transcribe_meta?: string | null; original_name?: string; display_name?: string | null }
      | undefined;

    const scenarioKey = normalizeScenario(fileInfo?.scenario) as ScenarioKey;
    const promptConfig = getPromptConfigForScenario(fileInfo?.scenario);
    const filename = fileInfo?.display_name?.trim() || fileInfo?.original_name?.trim() || '';

    let buildPromptMeta: { team_home_name?: string; team_away_name?: string; roster_combined?: string; keywords?: string } | undefined;
    try {
      const meta =
        fileInfo?.transcribe_meta != null ? (JSON.parse(fileInfo.transcribe_meta) as any) : null;
      const teamHomeId = meta?.team_home_id;
      const teamAwayId = meta?.team_away_id;
      const keywords = meta?.keywords != null ? String(meta.keywords).trim() : undefined;
      const rosterMode = meta?.roster_mode === 'none' || meta?.roster_mode === 'full' || meta?.roster_mode === 'starting'
        ? meta.roster_mode
        : 'full';
      const selectedPlayers = Array.isArray(meta?.selected_players)
        ? meta?.selected_players.filter((v: unknown) => typeof v === 'string' && (v as string).trim()).map((v: string) => v.trim())
        : undefined;
      const useRoster = rosterMode !== 'none';
      const useStarting = rosterMode === 'starting';

      const rosterParts: string[] = [];
      let teamHomeName: string | undefined;
      let teamAwayName: string | undefined;

      if (teamHomeId) {
        const row = db.prepare('SELECT name, roster_text FROM teams WHERE id = ?').get(teamHomeId) as
          | { name: string; roster_text: string | null }
          | undefined;
        if (row) {
          teamHomeName = row.name;
          if (useRoster && !useStarting && row.roster_text?.trim()) rosterParts.push(row.roster_text.trim());
        }
      }
      if (teamAwayId) {
        const row = db.prepare('SELECT name, roster_text FROM teams WHERE id = ?').get(teamAwayId) as
          | { name: string; roster_text: string | null }
          | undefined;
        if (row) {
          teamAwayName = row.name;
          if (useRoster && !useStarting && row.roster_text?.trim()) rosterParts.push(row.roster_text.trim());
        }
      }
      if (useStarting && selectedPlayers && selectedPlayers.length > 0) {
        rosterParts.push(selectedPlayers.join(', '));
      }

      const roster_combined =
        rosterParts.length > 0
          ? rosterParts
              .join(', ')
              .replace(/\s+/g, ' ')
              .replace(/,+/g, ',')
              .trim()
          : undefined;

      if (teamHomeName || teamAwayName || roster_combined || keywords) {
        buildPromptMeta = {
          team_home_name: teamHomeName,
          team_away_name: teamAwayName,
          roster_combined,
          keywords
        };
      }
    } catch (_e) {
      // ignore parse error, proceed without meta
    }

    const initial_prompt = buildPrompt(filename, scenarioKey, buildPromptMeta);

    try {
      // 1. Extracting
      currentStage = 'extracting';
      this.updateStatus(taskId, 'extracting');

      // 提取音频 (转为 16kHz WAV) 并获取时长
      // 音频会先提取到原始文件所在目录
      const extracted = await AudioExtractor.extract(filepath);
      let tempAudioPath = extracted.path;
      duration = extracted.duration;

      // 使用统一的路径服务获取项目ID和最终音频路径
      const projectId = taskId;
      const basePath = ProjectPathService.parseBasePathFromPath(filepath);

      if (!basePath) {
        throw new Error(`无法从文件路径解析存储基础路径: ${filepath}`);
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
            logger.info({ taskId, audioPath: finalAudioPath }, 'Audio moved to project directory');
          }
        } catch (moveErr: any) {
          // 如果移动失败，尝试复制后删除
          logger.warn({ taskId, err: moveErr }, 'Failed to move audio file, trying copy');
          if (fs.existsSync(tempAudioPath)) {
            fs.copyFileSync(tempAudioPath, finalAudioPath);
            fs.unlinkSync(tempAudioPath);
          }
        }
      }

      audioPath = finalAudioPath;

      logger.info({ taskId, audioPath, duration: duration.toFixed(2) }, 'Audio extracted');
      try {
        const stats = fs.statSync(audioPath);
        logger.debug({ taskId, size: stats.size, modified: stats.mtime.toISOString() }, 'Audio file stats');
      } catch (statErr) {
        logger.warn({ taskId, audioPath, err: statErr }, 'Failed to stat audio file');
      }

      // 2. Transcribing
      currentStage = 'transcribing';
      this.updateStatus(taskId, 'transcribing', {
        audio_path: audioPath,
        duration: duration
      });
      logger.debug({ taskId }, "Status updated to 'transcribing'");
      if (initial_prompt) {
        logger.debug({ taskId, initial_prompt }, 'Transcribe initial_prompt');
      }

      // 调用 Python Worker（传入 duration 与动态 initial_prompt）
      const result = await this.runPythonWorker(audioPath, duration, taskId, {
        task: 'transcribe',
        initial_prompt: initial_prompt || undefined,
        condition_on_previous_text: promptConfig.conditionOnPreviousText,
        compression_ratio_threshold: promptConfig.compressionRatioThreshold
      });

      // 3. Saving Result
      const insertStmt = db.prepare(`
        INSERT INTO transcriptions (media_file_id, content, format)
        VALUES (?, ?, 'json')
      `);
      insertStmt.run(taskId, JSON.stringify(result));

      // 4. Completed（清除进度字段）
      currentStage = 'completed';
      this.updateStatus(taskId, 'completed', { transcription_progress: null });
      logger.info({ taskId }, 'Task completed successfully');

    } catch (error: any) {
      logger.error({ taskId, stage: currentStage, err: error }, 'Task failed');

      if (audioPath && fs.existsSync(audioPath)) {
        try {
          const diagnosticsDir = path.join(__dirname, '../diagnostics');
          fs.mkdirSync(diagnosticsDir, { recursive: true });
          const diagFilename = `${taskId}-${Date.now()}-${path.basename(audioPath)}`;
          const diagPath = path.join(diagnosticsDir, diagFilename);
          fs.copyFileSync(audioPath, diagPath);
          logger.debug({ taskId, diagPath }, 'Copied failing audio to diagnostics');
        } catch (copyErr) {
          logger.warn({ taskId, err: copyErr }, 'Failed to copy audio for diagnostics');
        }
      }

      this.updateStatus(taskId, 'error', {
        error_message: error.message,
        failed_stage: currentStage,
        transcription_progress: null
      });
    }
  }

  /**
   * 更新转写进度（节流：进度变化 ≥2% 或 距上次 ≥1s 才写库）
   */
  private updateTranscriptionProgressThrottled(taskId: string, progressPct: number) {
    const now = Date.now();
    if (
      progressPct - this.progressThrottleLastPct >= 2 ||
      now - this.progressThrottleLastTs >= 1000
    ) {
      this.progressThrottleLastPct = progressPct;
      this.progressThrottleLastTs = now;
      try {
        db.prepare('UPDATE media_files SET transcription_progress = ? WHERE id = ?').run(progressPct, taskId);
        logger.debug({ taskId, progressPct }, 'Transcription progress updated');
      } catch (e) {
        logger.warn({ taskId, progressPct, err: e }, 'Failed to update transcription progress');
      }
    }
  }

  private async handleTranslate(payload: { id: string; target_language?: string }) {
    await runTranslation(payload.id, payload.target_language ?? 'en');
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
   * @param audioPath 音频文件路径
   * @param duration 音频总时长(秒)，用于 worker 计算进度
   * @param taskId 当前任务 id，用于进度写库
   */
  private runPythonWorker(
    audioPath: string,
    duration: number,
    taskId: string,
    options?: WorkerOptions
  ): Promise<any> {
    this.ensurePythonWorker();

    return new Promise((resolve, reject) => {
      if (!this.pythonWorker || !this.pythonWorker.stdin.writable) {
        return reject(new Error('Python worker is not available'));
      }

      if (this.pendingWorkerRequest) {
        return reject(new Error('Python worker is busy'));
      }

      this.progressThrottleLastPct = 0;
      this.progressThrottleLastTs = 0;
      this.pendingWorkerRequest = { resolve, reject, taskId };
      const payloadObj: Record<string, unknown> = {
        id: ++this.workerRequestId,
        audio_file: audioPath,
        duration: duration
      };
      if (options?.task) payloadObj.task = options.task;
      if (options?.initial_prompt !== undefined) payloadObj.initial_prompt = options.initial_prompt;
      if (options?.language !== undefined) payloadObj.language = options.language;
      if (options?.condition_on_previous_text !== undefined) {
        payloadObj.condition_on_previous_text = options.condition_on_previous_text;
      }
      if (options?.compression_ratio_threshold !== undefined) {
        payloadObj.compression_ratio_threshold = options.compression_ratio_threshold;
      }
      const payload = JSON.stringify(payloadObj);
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

    if (message.type === 'progress') {
      if (this.pendingWorkerRequest && message.progress_pct != null) {
        this.updateTranscriptionProgressThrottled(this.pendingWorkerRequest.taskId, Number(message.progress_pct));
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
