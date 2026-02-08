import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import readline from 'node:readline';
import db from './db';
import { AudioExtractor } from './services/audio';
import { ProjectPathService } from './services/projectPath';
import { StorageService } from './services/storage';
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

type TaskType = 'extract' | 'transcribe' | 'burn_subtitle' | 'translate';

interface TranscribePayload {
  id: string;
  filepath: string;
}

type TaskPayloadMap = {
  extract: { id: string; filepath: string };
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
  transcription_started_at?: string | null;
  transcription_first_segment_at?: string | null;
}

interface WorkerOptions {
  initial_prompt?: string;
  task?: 'transcribe' | 'translate';
  language?: string | null;
  condition_on_previous_text?: boolean;
  compression_ratio_threshold?: number;
}

interface TranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

class QueueService {
  private queue: Task[] = [];
  private isProcessing = false;
  private pythonWorker: ChildProcessWithoutNullStreams | null = null;
  private currentTaskId: string | null = null;
  private currentExtractionAbort: AbortController | null = null;
  private cancelledTaskIds = new Set<string>();
  private currentTranscriptionId: string | null = null;
  private currentTranscriptionRowId: number | null = null;
  private currentSegments: TranscriptionSegment[] = [];
  private currentSegmentIndex = 0;
  private segmentBufferedCount = 0;
  private segmentFlushLastTs = 0;
  private transcriptionStartedAtMs: number | null = null;
  private firstSegmentAtMs: number | null = null;
  private pythonWorkerReadline: readline.Interface | null = null;
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
    this.registerHandler('extract', this.handleExtract.bind(this));
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

  cancelByProjectId(id: string) {
    const before = this.queue.length;
    this.queue = this.queue.filter((task) => (task.payload as any).id !== id);
    const removed = before - this.queue.length;
    this.cancelledTaskIds.add(id);

    try {
      this.updateStatus(id, 'cancelled', {
        error_message: '任务已取消',
        failed_stage: 'cancelled',
        transcription_progress: null
      });
    } catch (_e) {
      // ignore db errors for cancelled tasks
    }

    if (this.currentTaskId === id) {
      if (this.currentExtractionAbort) {
        this.currentExtractionAbort.abort();
      }
      if (this.pendingWorkerRequest?.taskId === id) {
        this.pendingWorkerRequest.reject(new Error('Task cancelled'));
        this.pendingWorkerRequest = null;
      }
      if (this.currentTranscriptionId === id) {
        this.currentTranscriptionId = null;
        this.currentTranscriptionRowId = null;
        this.currentSegments = [];
        this.currentSegmentIndex = 0;
        this.segmentBufferedCount = 0;
        this.segmentFlushLastTs = 0;
      }
      if (this.pythonWorker) {
        this.pythonWorker.kill('SIGTERM');
        this.pythonWorker = null;
      }
    }

    return { removed };
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
    if (extra.transcription_started_at !== undefined) {
      updates.push('transcription_started_at = ?');
      params.push(extra.transcription_started_at);
    }
    if (extra.transcription_first_segment_at !== undefined) {
      updates.push('transcription_first_segment_at = ?');
      params.push(extra.transcription_first_segment_at);
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

    this.currentTaskId = (task.payload as any).id ?? null;
    const handler = this.handlers[task.type];
    if (!handler) {
      logger.error({ type: task.type }, 'No handler registered for task type');
      this.isProcessing = false;
      this.currentTaskId = null;
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
      this.currentTaskId = null;
      this.processNext();
    }
  }

  private async handleTranscribe(payload: TranscribePayload) {
    const taskId = payload.id;
    const filepath = payload.filepath;
    let currentStage = 'pending';
    let audioPath: string | null = null;
    let duration = 0;
    const isCancelled = () => this.cancelledTaskIds.has(taskId);

    if (isCancelled()) {
      this.updateStatus(taskId, 'cancelled', { error_message: '任务已取消', failed_stage: 'cancelled' });
      return;
    }
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
        const meta: { team_home_name?: string; team_away_name?: string; roster_combined?: string; keywords?: string } = {};
        if (teamHomeName) meta.team_home_name = teamHomeName;
        if (teamAwayName) meta.team_away_name = teamAwayName;
        if (roster_combined) meta.roster_combined = roster_combined;
        if (keywords) meta.keywords = keywords;
        buildPromptMeta = meta;
      }
    } catch (_e) {
      // ignore parse error, proceed without meta
    }

    const initial_prompt = buildPrompt(filename, scenarioKey, buildPromptMeta);

    try {
      const audioRow = db.prepare('SELECT audio_path, duration FROM media_files WHERE id = ?').get(taskId) as
        | { audio_path?: string | null; duration?: number | null }
        | undefined;
      audioPath = audioRow?.audio_path ?? null;
      duration = audioRow?.duration ?? 0;

      if (!audioPath || !fs.existsSync(audioPath)) {
        throw new Error('音频尚未提取，无法开始转写');
      }

      // 1. Transcribing
      currentStage = 'transcribing';
      const startedAt = new Date().toISOString();
      this.updateStatus(taskId, 'transcribing', {
        audio_path: audioPath,
        duration: duration,
        transcription_started_at: startedAt,
        transcription_first_segment_at: null
      });
      logger.debug({ taskId }, "Status updated to 'transcribing'");
      if (initial_prompt) {
        logger.debug({ taskId, initial_prompt }, 'Transcribe initial_prompt');
      }

      // 清空旧转写并初始化空记录，确保流式可读
      try {
        const existing = db.prepare('SELECT id FROM transcriptions WHERE media_file_id = ?').get(taskId) as
          | { id: number }
          | undefined;
        if (existing?.id != null) {
          db.prepare('DELETE FROM translation_segments WHERE transcription_id = ?').run(existing.id);
          db.prepare('DELETE FROM transcription_segments WHERE transcription_id = ?').run(existing.id);
        }
        db.prepare('DELETE FROM transcriptions WHERE media_file_id = ?').run(taskId);
      } catch (_e) {
        // ignore
      }
      const emptyContent = JSON.stringify({ segments: [] as TranscriptionSegment[], text: '' });
      const insertResult = db.prepare(
        `INSERT INTO transcriptions (media_file_id, content, format, stream_translate_enabled, stream_translate_status, stream_translate_language)
         VALUES (?, ?, ?, 0, 'idle', 'zh')`
      ).run(
        taskId,
        emptyContent,
        'json'
      );
      this.currentTranscriptionId = taskId;
      this.currentTranscriptionRowId = Number(insertResult.lastInsertRowid);
      this.currentSegments = [];
      this.currentSegmentIndex = 0;
      this.segmentBufferedCount = 0;
      this.segmentFlushLastTs = 0;
      this.transcriptionStartedAtMs = Date.now();
      this.firstSegmentAtMs = null;

      // 调用 Python Worker（传入 duration 与动态 initial_prompt）
      const workerOptions: WorkerOptions = { task: 'transcribe' };
      if (initial_prompt) workerOptions.initial_prompt = initial_prompt;
      if (promptConfig.conditionOnPreviousText !== undefined) {
        workerOptions.condition_on_previous_text = promptConfig.conditionOnPreviousText;
      }
      if (promptConfig.compressionRatioThreshold !== undefined) {
        workerOptions.compression_ratio_threshold = promptConfig.compressionRatioThreshold;
      }

      const result = await this.runPythonWorker(audioPath, duration, taskId, workerOptions);

      if (isCancelled()) {
        throw new Error('Task cancelled');
      }

      // 2. Saving Result
      this.flushSegmentBuffer(true);
      db.prepare('UPDATE transcriptions SET content = ?, format = ? WHERE media_file_id = ?').run(
        JSON.stringify(result),
        'json',
        taskId
      );

      // 3. Completed（清除进度字段）
      currentStage = 'completed';
      this.updateStatus(taskId, 'completed', { transcription_progress: null });
      logger.info({ taskId }, 'Task completed successfully');

    } catch (error: any) {
      if (error?.message === 'Task cancelled' || error?.message === 'Extraction cancelled') {
        logger.warn({ taskId, stage: currentStage }, 'Task cancelled');
        this.updateStatus(taskId, 'cancelled', {
          error_message: '任务已取消',
          failed_stage: 'cancelled',
          transcription_progress: null
        });
        return;
      }

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
    } finally {
      this.currentTranscriptionId = null;
      this.currentTranscriptionRowId = null;
      this.currentSegments = [];
      this.currentSegmentIndex = 0;
      this.segmentBufferedCount = 0;
      this.segmentFlushLastTs = 0;
      this.transcriptionStartedAtMs = null;
      this.firstSegmentAtMs = null;
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
    if (this.cancelledTaskIds.has(payload.id)) {
      return;
    }
    await runTranslation(payload.id, payload.target_language ?? 'en');
  }

  private async handleExtract(payload: { id: string; filepath: string }) {
    const taskId = payload.id;
    const filepath = payload.filepath;
    let currentStage = 'waiting_extract';
    const isCancelled = () => this.cancelledTaskIds.has(taskId);

    if (isCancelled()) {
      this.updateStatus(taskId, 'cancelled', { error_message: '任务已取消', failed_stage: 'cancelled' });
      return;
    }

    try {
      const audioRow = db.prepare('SELECT audio_path FROM media_files WHERE id = ?').get(taskId) as
        | { audio_path?: string | null }
        | undefined;
      if (audioRow?.audio_path && fs.existsSync(audioRow.audio_path)) {
        this.updateStatus(taskId, 'ready_to_transcribe');
        return;
      }

      currentStage = 'extracting';
      this.updateStatus(taskId, 'extracting');

      const projectId = taskId;
      const isProjectPath = ProjectPathService.isProjectPath(filepath);
      const basePath = isProjectPath
        ? ProjectPathService.parseBasePathFromPath(filepath)
        : StorageService.getBestStoragePath();

      if (!basePath) {
        throw new Error(`无法从文件路径解析存储基础路径: ${filepath}`);
      }

      const projectDir = ProjectPathService.ensureProjectDir(basePath, projectId);
      const finalAudioPath = ProjectPathService.getAudioFilePath(basePath, projectId);

      this.currentExtractionAbort = new AbortController();
      const extracted = await AudioExtractor.extract(filepath, projectDir, this.currentExtractionAbort.signal);
      this.currentExtractionAbort = null;
      let tempAudioPath = extracted.path;
      const duration = extracted.duration;

      if (isCancelled()) {
        throw new Error('Task cancelled');
      }

      if (tempAudioPath !== finalAudioPath) {
        try {
          if (fs.existsSync(tempAudioPath)) {
            if (fs.existsSync(finalAudioPath)) {
              fs.unlinkSync(finalAudioPath);
            }
            fs.renameSync(tempAudioPath, finalAudioPath);
            logger.info({ taskId, audioPath: finalAudioPath }, 'Audio moved to project directory');
          }
        } catch (moveErr: any) {
          logger.warn({ taskId, err: moveErr }, 'Failed to move audio file, trying copy');
          if (fs.existsSync(tempAudioPath)) {
            fs.copyFileSync(tempAudioPath, finalAudioPath);
            fs.unlinkSync(tempAudioPath);
          }
        }
      }

      this.updateStatus(taskId, 'ready_to_transcribe', {
        audio_path: finalAudioPath,
        duration: duration,
        transcription_progress: null
      });
    } catch (error: any) {
      this.currentExtractionAbort = null;
      if (error?.message === 'Task cancelled' || error?.message === 'Extraction cancelled') {
        logger.warn({ taskId, stage: currentStage }, 'Task cancelled');
        this.updateStatus(taskId, 'cancelled', {
          error_message: '任务已取消',
          failed_stage: 'cancelled',
          transcription_progress: null
        });
        return;
      }

      logger.error({ taskId, stage: currentStage, err: error }, 'Extract task failed');
      this.updateStatus(taskId, 'error', {
        error_message: error.message,
        failed_stage: currentStage,
        transcription_progress: null
      });
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

    this.pythonWorkerReadline = readline.createInterface({
      input: this.pythonWorker.stdout,
      crlfDelay: Infinity
    });
    this.pythonWorkerReadline.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed) {
        this.handleWorkerMessage(trimmed);
      }
    });

    this.pythonWorker.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (!text) return;
      const level = /error|exception|traceback|failed/i.test(text) ? 'error' : /warn|deprecated/i.test(text) ? 'warn' : 'info';
      if (level === 'error') {
        logger.error({ stderr: text }, 'Worker stderr');
      } else if (level === 'warn') {
        logger.warn({ stderr: text }, 'Worker stderr');
      } else {
        logger.info({ stderr: text }, 'Worker stderr');
      }
    });

    this.pythonWorker.on('close', (code) => {
      logger.error({ exitCode: code }, 'Worker exited');
      if (this.pendingWorkerRequest) {
        this.pendingWorkerRequest.reject(new Error(`Worker exited with code ${code}`));
        this.pendingWorkerRequest = null;
      }
      if (this.pythonWorkerReadline) {
        this.pythonWorkerReadline.close();
        this.pythonWorkerReadline = null;
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

  private flushSegmentBuffer(force = false) {
    if (!this.currentTranscriptionId) return;
    if (this.currentSegments.length === 0) return;
    const now = Date.now();
    if (!force) {
      const timeOk = now - this.segmentFlushLastTs >= 2000;
      const countOk = this.segmentBufferedCount >= 5;
      if (!timeOk && !countOk) return;
    }
    const content = {
      segments: this.currentSegments,
      text: this.currentSegments.map((s) => s.text).join('')
    };
    try {
      db.prepare('UPDATE transcriptions SET content = ?, format = ? WHERE media_file_id = ?').run(
        JSON.stringify(content),
        'json',
        this.currentTranscriptionId
      );
      this.segmentBufferedCount = 0;
      this.segmentFlushLastTs = now;
    } catch (e) {
      logger.warn({ taskId: this.currentTranscriptionId, err: e }, 'Failed to flush transcription segments');
    }
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

    if (message.type === 'segment') {
      if (!this.pendingWorkerRequest || !this.currentTranscriptionId || !this.currentTranscriptionRowId) {
        return;
      }
      const data = message.data;
      if (
        data &&
        typeof data.start === 'number' &&
        typeof data.end === 'number' &&
        typeof data.text === 'string'
      ) {
        this.currentSegments.push({
          start: data.start,
          end: data.end,
          text: data.text
        });
        try {
          db.prepare(
            `INSERT INTO transcription_segments (transcription_id, segment_index, start_time, end_time, text)
             VALUES (?, ?, ?, ?, ?)`
          ).run(
            this.currentTranscriptionRowId,
            this.currentSegmentIndex,
            data.start,
            data.end,
            data.text
          );
        } catch (e) {
          logger.warn({ taskId: this.currentTranscriptionId, err: e }, 'Failed to insert transcription segment');
        }
        this.currentSegmentIndex += 1;
        this.segmentBufferedCount += 1;
        if (!this.firstSegmentAtMs) {
          this.firstSegmentAtMs = Date.now();
          const firstSegmentAt = new Date(this.firstSegmentAtMs).toISOString();
          this.updateStatus(this.currentTranscriptionId, 'transcribing', {
            transcription_first_segment_at: firstSegmentAt
          });
          if (this.transcriptionStartedAtMs) {
            const prepMs = this.firstSegmentAtMs - this.transcriptionStartedAtMs;
            logger.info({ taskId: this.currentTranscriptionId, prepMs }, 'First segment received');
          }
        }
        this.flushSegmentBuffer(false);
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
