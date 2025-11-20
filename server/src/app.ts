import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import db from './db';
import queue from './queue';

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
    // 复用 transcriptions/:id 的逻辑，直接重定向或者调用相同处理函数
    // 这里为了简单直接拷贝逻辑，但通常应该提取 controller
    const { id } = request.params as { id: string };

    const fileStmt = db.prepare('SELECT * FROM media_files WHERE id = ?');
    const file = fileStmt.get(id) as any;

    if (!file) {
      return reply.code(404).send({ error: 'Project not found' });
    }

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
      } catch (e) {
        transcription = result;
      }
    }

    return {
      id: file.id,
      filename: file.filename,
      original_name: file.original_name,
      status: file.status,
      created_at: file.created_at,
      transcription
    };
  });

  // 删除项目
  fastify.delete('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    // 1. 获取文件路径
    const fileStmt = db.prepare('SELECT filepath FROM media_files WHERE id = ?');
    const file = fileStmt.get(id) as { filepath: string };

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
        console.log(`[Delete] Deleted file: ${file.filepath}`);
      }
    } catch (e) {
      console.error(`[Delete] Failed to delete file ${file.filepath}:`, e);
    }

    return { status: 'success', id };
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
