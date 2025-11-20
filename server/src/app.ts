import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import db from './db';
import queue from './queue';

const fastify = Fastify({
  logger: true
});

// 注册插件
fastify.register(cors, {
  origin: true // 允许所有来源，开发阶段方便
});

fastify.register(multipart, {
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB
  }
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

// 启动服务
const start = async () => {
  try {
    const port = 3000;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`Server listening at http://localhost:${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
