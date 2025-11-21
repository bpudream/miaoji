import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import db from './db';
import queue from './queue';
import { ollamaService, SummaryMode } from './services/ollama';

export const buildApp = () => {
  const fastify = Fastify({
    logger: {
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    }
  });

  // 注册插件
  fastify.register(cors, {
    origin: true, // 允许所有来源，开发阶段方便
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  fastify.register(multipart, {
    limits: {
      fileSize: 4 * 1024 * 1024 * 1024, // 4GB 默认限制
    }
  });

  // 全局错误处理
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const statusCode = (error as any).statusCode || 500;
    reply.status(statusCode).send({
      error: (error as any).name || 'Internal Server Error',
      message: (error as any).message || 'Something went wrong',
      statusCode
    });
  });

  // 确保上传目录存在
  const UPLOAD_DIR = path.join(__dirname, '../uploads');
  if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  }

  // 基础路由
  fastify.get('/', async (request, reply) => {
    return { hello: 'world' };
  });

  fastify.get('/api/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // 文件上传路由
  fastify.post('/api/upload', async (req, reply) => {
    const data = await req.file();

    if (!data) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    // 验证文件类型
    const ALLOWED_TYPES = [
      'audio/mpeg', 'audio/wav', 'audio/x-m4a', 'audio/mp4', 'audio/aac', 'audio/flac', 'audio/ogg',
      'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/x-matroska', 'video/webm'
    ];

    if (!ALLOWED_TYPES.includes(data.mimetype)) {
      data.file.resume(); // 丢弃流数据
      return reply.code(400).send({
        error: 'Unsupported file type',
        message: `File type ${data.mimetype} is not allowed.`,
        allowed: ALLOWED_TYPES
      });
    }

    const filename = `${Date.now()}-${data.filename}`;
    const filepath = path.join(UPLOAD_DIR, filename);

    await pipeline(data.file, fs.createWriteStream(filepath));

    // 验证文件
    const stats = await fs.promises.stat(filepath);
    if (stats.size === 0) {
      throw new Error('File upload failed: Empty file');
    }
    console.log(`[Upload] Saved ${filename} (${stats.size} bytes)`);

    // 插入数据库
    const stmt = db.prepare(`
      INSERT INTO media_files (filename, filepath, original_name, mime_type, status)
      VALUES (?, ?, ?, ?, ?)
    `);

    const info = stmt.run(filename, filepath, data.filename, data.mimetype, 'pending');

    const fileId = Number(info.lastInsertRowid);
    queue.add(fileId, filepath);

    return {
      status: 'success',
      path: filepath,
      filename: filename,
      id: fileId
    };
  });

  fastify.get('/api/transcriptions/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    const fileStmt = db.prepare('SELECT * FROM media_files WHERE id = ?');
    const file = fileStmt.get(id) as any;

    if (!file) {
      return reply.code(404).send({ error: 'File not found' });
    }

    let transcription = null;
    if (file.status === 'completed') {
      const transStmt = db.prepare('SELECT * FROM transcriptions WHERE media_file_id = ?');
      const result = transStmt.get(id) as any;
      if (result) {
        try {
          // 如果是 JSON 格式字符串，尝试解析
          transcription = {
            ...result,
            content: result.format === 'json' ? JSON.parse(result.content) : result.content
          };
        } catch (e) {
          transcription = result;
        }
      }
    }

    return {
      id: file.id,
      filename: file.filename,
      original_name: file.original_name,
      status: file.status, // pending, processing, completed, error
      created_at: file.created_at,
      transcription
    };
  });

  // 更新转写结果
  fastify.put('/api/projects/:id/transcription', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { segments } = request.body as { segments: any[] };

    if (!segments || !Array.isArray(segments)) {
      return reply.code(400).send({ error: 'Invalid segments data' });
    }

    const transStmt = db.prepare('SELECT * FROM transcriptions WHERE media_file_id = ?');
    const existingTrans = transStmt.get(id) as any;

    if (!existingTrans) {
      return reply.code(404).send({ error: 'Transcription not found' });
    }

    let content: any = {};
    try {
      content = existingTrans.format === 'json' ? JSON.parse(existingTrans.content) : {};
    } catch (e) {
      // ignore
    }

    // Update segments and regenerate full text
    content.segments = segments;
    content.text = segments.map(s => s.text).join('');

    const updateStmt = db.prepare('UPDATE transcriptions SET content = ? WHERE media_file_id = ?');
    updateStmt.run(JSON.stringify(content), id);

    return { status: 'success', transcription: { ...existingTrans, content } };
  });

  // 获取项目列表
  fastify.get('/api/projects', async (request, reply) => {
    const { page = 1, pageSize = 10, status } = request.query as { page?: number, pageSize?: number, status?: string };
    const offset = (Number(page) - 1) * Number(pageSize);

    let sql = 'SELECT id, original_name, status, created_at, filename FROM media_files';
    const params: any[] = [];

    if (status) {
      sql += ' WHERE status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(pageSize), offset);

    const stmt = db.prepare(sql);
    const projects = stmt.all(...params);

    const countStmt = db.prepare('SELECT COUNT(*) as total FROM media_files' + (status ? ' WHERE status = ?' : ''));
    const totalResult = countStmt.get(...(status ? [status] : [])) as { total: number };

    return {
      data: projects,
      pagination: {
        page: Number(page),
        pageSize: Number(pageSize),
        total: totalResult.total,
        totalPages: Math.ceil(totalResult.total / Number(pageSize))
      }
    };
  });

  // 获取单个项目详情 (目前与 transcriptions/:id 逻辑类似，但作为通用入口)
  fastify.get('/api/projects/:id', async (request, reply) => {
    // 添加禁止缓存头，替代前端的 _t 参数
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    reply.header('Pragma', 'no-cache');
    reply.header('Expires', '0');

    // 复用 transcriptions/:id 的逻辑，直接重定向或者调用相同处理函数
    // 这里为了简单直接拷贝逻辑，但通常应该提取 controller
    const { id } = request.params as { id: string };

    const fileStmt = db.prepare('SELECT * FROM media_files WHERE id = ?');
    const file = fileStmt.get(id) as any;

    if (!file) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    console.log(`[API] GET /api/projects/${id} - Current status: ${file.status}`);

    let transcription = null;
    // 即使未完成，也可能想看详情，这里不做 status 限制，只查有没有 result
    const transStmt = db.prepare('SELECT * FROM transcriptions WHERE media_file_id = ?');
    const result = transStmt.get(id) as any;

    if (result) {
      try {
        transcription = {
          ...result,
          content: result.format === 'json' ? JSON.parse(result.content) : result.content
        };
        console.log(`[API] Fetched transcription for ${id}. Format: ${result.format}, Content Type: ${typeof transcription.content}`);
      } catch (e) {
        console.error(`[API] Failed to parse transcription content for ${id}:`, e);
        transcription = result;
      }
    }

    return {
      id: file.id,
      filename: file.filename,
      original_name: file.original_name,
      status: file.status,
      created_at: file.created_at,
      duration: file.duration, // ✅ 添加 duration 字段
      mime_type: file.mime_type, // ✅ 添加 mime_type 字段用于判断音频/视频
      audio_path: file.audio_path, // ✅ 添加 audio_path 字段，用于播放提取的音频
      transcription
    };
  });

  // 生成总结
  fastify.post('/api/projects/:id/summarize', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { mode = 'brief' } = request.body as { mode: SummaryMode };

    // 1. 获取项目和转写结果
    const fileStmt = db.prepare('SELECT * FROM media_files WHERE id = ?');
    const file = fileStmt.get(id) as any;

    if (!file) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // Check if transcription exists
    const transStmt = db.prepare('SELECT * FROM transcriptions WHERE media_file_id = ?');
    const transcription = transStmt.get(id) as any;

    if (!transcription || !transcription.content) {
      return reply.code(400).send({ error: 'No transcription available for this project' });
    }

    let fullText = '';
    try {
      // Handle both JSON (segments) and plain text content
      if (transcription.format === 'json') {
        const content = JSON.parse(transcription.content);
        if (content.fullText) {
          fullText = content.fullText;
        } else if (Array.isArray(content)) {
           fullText = content.map((s: any) => s.text).join(' ');
        } else if (content.segments) {
           fullText = content.segments.map((s: any) => s.text).join(' ');
        }
      } else {
        fullText = transcription.content;
      }
    } catch (e) {
      fullText = transcription.content; // Fallback to raw content
    }

    if (!fullText) {
       return reply.code(400).send({ error: 'Transcription text is empty' });
    }

    try {
      // 2. 检查 Ollama 服务
      const isRunning = await ollamaService.ensureRunning();
      if (!isRunning) {
        return reply.code(503).send({ error: 'Ollama service is not available. Please make sure Ollama is running.' });
      }

      // 3. 生成 Prompt
      const { prompt, system } = ollamaService.getPrompts(fullText, mode);

      // 4. 调用 Ollama (非流式，简单起见)
      const summaryText = await ollamaService.generate(prompt, system);

      // 5. 保存/更新到数据库
      // Remove previous summaries of same mode to keep it clean?
      // db.prepare('DELETE FROM summaries WHERE media_file_id = ? AND mode = ?').run(id, mode);

      const insertStmt = db.prepare(`
        INSERT INTO summaries (media_file_id, content, model, mode)
        VALUES (?, ?, ?, ?)
      `);
      insertStmt.run(id, summaryText, 'qwen3:14b', mode);

      return {
        status: 'success',
        summary: summaryText,
        mode
      };

    } catch (error: any) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Failed to generate summary', details: error.message });
    }
  });

  // 获取总结
  fastify.get('/api/projects/:id/summary', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { mode } = request.query as { mode?: string };

    let sql = 'SELECT * FROM summaries WHERE media_file_id = ?';
    const params: any[] = [id];

    if (mode) {
      sql += ' AND mode = ?';
      params.push(mode);
    }

    sql += ' ORDER BY created_at DESC LIMIT 1';

    const stmt = db.prepare(sql);
    const summary = stmt.get(...params);

    if (!summary) {
      return reply.code(404).send({ error: 'Summary not found' });
    }

    return summary;
  });

  const sanitizeFilename = (name: string) => {
    return name.replace(/[\\/:*?"<>|]+/g, '_').trim();
  };

  const buildContentDisposition = (baseName: string, ext: string, fallback: string) => {
    const sanitized = sanitizeFilename(baseName) || fallback;
    const ascii = sanitized
      .replace(/[^\x20-\x7E]+/g, '_')
      .replace(/\s+/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '') || fallback;
    const encoded = encodeURIComponent(`${sanitized}.${ext}`);
    return `attachment; filename="${ascii}.${ext}"; filename*=UTF-8''${encoded}`;
  };

  const parseTranscriptionContent = (transcription: any) => {
    let parsed: any = transcription.content;
    try {
      if (transcription.format === 'json') {
        parsed = JSON.parse(transcription.content);
      }
    } catch (e) {
      parsed = transcription.content;
    }

    let segments: any[] = [];
    let text = '';

    if (Array.isArray(parsed)) {
      segments = parsed;
      text = parsed.map((s) => s.text).join(' ');
    } else if (parsed && typeof parsed === 'object') {
      if (Array.isArray(parsed.segments)) {
        segments = parsed.segments;
      }
      text = parsed.fullText || parsed.text || parsed.content || '';
      if (!text && segments.length) {
        text = segments.map((s: any) => s.text).join(' ');
      }
    } else if (typeof parsed === 'string') {
      text = parsed;
    }

    if (!text && typeof transcription.content === 'string') {
      text = transcription.content;
    }

    return { parsed, segments, text };
  };

  const formatSrtTimestamp = (seconds: number) => {
    const totalMs = Math.round(seconds * 1000);
    const hours = Math.floor(totalMs / 3_600_000);
    const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
    const secs = Math.floor((totalMs % 60_000) / 1000);
    const ms = totalMs % 1000;
    const pad = (num: number, len: number) => num.toString().padStart(len, '0');
    return `${pad(hours, 2)}:${pad(minutes, 2)}:${pad(secs, 2)},${pad(ms, 3)}`;
  };

  // 提供媒体文件访问
  fastify.get('/api/projects/:id/media', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { type } = request.query as { type?: 'original' | 'audio' };

    const fileStmt = db.prepare('SELECT filepath, audio_path, mime_type FROM media_files WHERE id = ?');
    const file = fileStmt.get(id) as { filepath: string; audio_path?: string; mime_type?: string };

    if (!file) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // 根据 type 参数决定返回原始文件还是音频文件
    let mediaPath: string;
    let mediaMimeType: string;

    if (type === 'audio' && file.audio_path) {
      mediaPath = file.audio_path;
      mediaMimeType = 'audio/wav'; // 提取的音频是 16kHz WAV
    } else {
      mediaPath = file.filepath;
      mediaMimeType = file.mime_type || 'application/octet-stream';
    }

    if (!fs.existsSync(mediaPath)) {
      return reply.code(404).send({ error: 'Media file not found' });
    }

    // 设置正确的 Content-Type
    reply.type(mediaMimeType || 'application/octet-stream');

    // 支持 Range 请求（用于视频/音频的流式播放）
    const stats = fs.statSync(mediaPath);
    const fileSize = stats.size;
    const range = request.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0] || '0', 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(mediaPath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': mediaMimeType,
      };
      reply.code(206).headers(head);
      return file;
    } else {
      reply.header('Content-Length', fileSize);
      reply.header('Accept-Ranges', 'bytes');
      return fs.createReadStream(mediaPath);
    }
  });

  fastify.get('/api/projects/:id/export', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { format = 'txt' } = request.query as { format?: string };

    const allowedFormats = ['txt', 'json', 'srt'];
    if (!allowedFormats.includes(format)) {
      return reply.code(400).send({ error: 'Unsupported export format' });
    }

    const fileStmt = db.prepare('SELECT * FROM media_files WHERE id = ?');
    const file = fileStmt.get(id) as any;

    if (!file) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    const transStmt = db.prepare('SELECT * FROM transcriptions WHERE media_file_id = ?');
    const transcription = transStmt.get(id) as any;

    if (!transcription) {
      return reply.code(404).send({ error: 'Transcription not found' });
    }

    const { parsed, segments, text } = parseTranscriptionContent(transcription);
    const fallbackName = `project-${id}`;
    const safeBaseName = sanitizeFilename(file.original_name || file.filename || fallbackName);

    if (format === 'json') {
      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.header('Content-Disposition', buildContentDisposition(safeBaseName, 'json', fallbackName));
      return parsed;
    }

    if (format === 'srt') {
      const usableSegments = segments.length
        ? segments
        : [
            {
              start: 0,
              end: Math.max(file.duration ?? 0, text ? text.length / 4 : 5),
              text: text || '',
            },
          ];

      const srt = usableSegments
        .map((seg: any, index: number) => {
          const start = formatSrtTimestamp(Number(seg.start) || 0);
          const end = formatSrtTimestamp(Number(seg.end) || Number(seg.start) + 1);
          const content = (seg.text || '').trim() || '(空)';
          return `${index + 1}\n${start} --> ${end}\n${content}\n`;
        })
        .join('\n');

      reply.header('Content-Type', 'application/x-subrip; charset=utf-8');
      reply.header('Content-Disposition', buildContentDisposition(safeBaseName, 'srt', fallbackName));
      return srt;
    }

    // default txt
    const plainText =
      text ||
      (segments.length ? segments.map((seg: any) => seg.text).join(' ') : transcription.content || '');

    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', buildContentDisposition(safeBaseName, 'txt', fallbackName));
    return plainText;
  });

  // 删除项目
  fastify.delete('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    // 1. 获取文件路径
    const fileStmt = db.prepare('SELECT filepath, audio_path FROM media_files WHERE id = ?');
    const file = fileStmt.get(id) as { filepath: string; audio_path?: string };

    if (!file) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // 2. 数据库删除
    // 使用事务确保原子性
    const deleteTransaction = db.transaction(() => {
      db.prepare('DELETE FROM transcriptions WHERE media_file_id = ?').run(id);
      db.prepare('DELETE FROM summaries WHERE media_file_id = ?').run(id);
      db.prepare('DELETE FROM media_files WHERE id = ?').run(id);
    });

    try {
      deleteTransaction();
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: 'Database deletion failed' });
    }

    // 3. 物理文件删除 (不阻塞响应)
    try {
      if (fs.existsSync(file.filepath)) {
        await fs.promises.unlink(file.filepath);
      }
      // 同时删除提取的音频文件
      if (file.audio_path && fs.existsSync(file.audio_path)) {
        await fs.promises.unlink(file.audio_path);
      }
    } catch (e) {
      console.error(`[Delete] Failed to delete files:`, e);
    }

    return { status: 'success', id };
  });

  // 重试项目
  fastify.post('/api/projects/:id/retry', async (request, reply) => {
    const { id } = request.params as { id: string };

    const fileStmt = db.prepare('SELECT * FROM media_files WHERE id = ?');
    const file = fileStmt.get(id) as any;

    if (!file) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    if (file.status !== 'error') {
      return reply.code(400).send({ error: 'Can only retry failed projects' });
    }

    // 重置状态
    const updateStmt = db.prepare(`
      UPDATE media_files
      SET status = 'pending', error_message = NULL, failed_stage = NULL
      WHERE id = ?
    `);
    updateStmt.run(id);

    // 清理旧的转写和总结，防止数据冲突
    db.prepare('DELETE FROM transcriptions WHERE media_file_id = ?').run(id);
    db.prepare('DELETE FROM summaries WHERE media_file_id = ?').run(id);

    // 重新加入队列
    // 如果原始文件不存在了，队列处理时会报错，循环进入 error 状态，这是合理的
    queue.add(file.id, file.filepath);

    return { status: 'success', message: 'Task queued for retry' };
  });

  return fastify;
};

// 启动服务
const start = async () => {
  const fastify = buildApp();
  try {
    const port = 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening at http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}
