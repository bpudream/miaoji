import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import db from './db';
import queue from './queue';
import { ollamaService, SummaryMode } from './services/ollama';
import { StorageService } from './services/storage';
import { ProjectPathService } from './services/projectPath';
import { calculateFileHash } from './services/fileHash';
import { DependencyChecker } from './services/dependencyCheck';

// 从环境变量读取配置
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || '3000', 10);

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

  // 确保默认上传目录存在（向后兼容）
  const DEFAULT_UPLOAD_DIR = path.join(__dirname, '../uploads');
  if (!fs.existsSync(DEFAULT_UPLOAD_DIR)) {
    fs.mkdirSync(DEFAULT_UPLOAD_DIR, { recursive: true });
  }

  // 基础路由
  fastify.get('/', async (request, reply) => {
    return { hello: 'world' };
  });

  fastify.get('/api/health', async (request, reply) => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // 判断网络接口类型
  const getInterfaceType = (interfaceName: string): { type: 'wifi' | 'ethernet' | 'other' | 'virtual' | 'bluetooth'; priority: number } => {
    const name = interfaceName.toLowerCase();

    // 排除虚拟网卡和蓝牙
    if (name.includes('bluetooth') || name.includes('蓝牙')) {
      return { type: 'bluetooth', priority: 0 };
    }
    if (name.includes('virtual') || name.includes('vmware') || name.includes('virtualbox') ||
        name.includes('hyper-v') || name.includes('wsl') || name.includes('vethernet') ||
        name.includes('loopback') || name.includes('teredo') || name.includes('isatap') ||
        name.includes('vpn') || name.includes('tap') || name.includes('docker')) {
      return { type: 'virtual', priority: 0 };
    }

    // WiFi 接口（优先级最高）
    if (name.includes('wi-fi') || name.includes('wlan') || name.includes('wireless') ||
        name.includes('wifi') || name.includes('802.11')) {
      return { type: 'wifi', priority: 3 };
    }

    // 以太网接口（次优先级）
    if (name.includes('ethernet') || name.includes('以太网') || name.includes('本地连接') ||
        name.includes('lan') || name.includes('eth')) {
      return { type: 'ethernet', priority: 2 };
    }

    // 其他接口
    return { type: 'other', priority: 1 };
  };

  // 获取配置的辅助函数
  const getSetting = (key: string, defaultValue: string): string => {
    try {
      const result = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
      return result?.value || defaultValue;
    } catch (e) {
      return defaultValue;
    }
  };

  // 获取系统状态信息（IP地址、端口等）
  fastify.get('/api/system/status', async (request, reply) => {
    const networkInterfaces = os.networkInterfaces();
    const interfaceList: Array<{
      name: string;
      ip: string;
      type: 'wifi' | 'ethernet' | 'other' | 'virtual' | 'bluetooth';
      priority: number;
    }> = [];
    const backendPort = BACKEND_PORT; // 从环境变量读取，不可配置

    // 前端端口从前端请求头获取（前端自己管理）
    // 如果前端没有提供，则返回 null
    const frontendPortHeader = request.headers['x-frontend-port'];
    const frontendPort = frontendPortHeader ? parseInt(String(frontendPortHeader), 10) : null;

    // 收集所有非内部 IPv4 地址及其接口信息
    for (const interfaceName in networkInterfaces) {
      const interfaces = networkInterfaces[interfaceName];
      if (interfaces) {
        const interfaceType = getInterfaceType(interfaceName);

        // 排除虚拟网卡和蓝牙
        if (interfaceType.priority === 0) {
          continue;
        }

        for (const iface of interfaces) {
          // 只获取 IPv4 地址，排除内部地址（127.0.0.1）
          if (iface.family === 'IPv4' && !iface.internal) {
            interfaceList.push({
              name: interfaceName,
              ip: iface.address,
              type: interfaceType.type,
              priority: interfaceType.priority,
            });
          }
        }
      }
    }

    // 按优先级排序：WiFi > 以太网 > 其他
    interfaceList.sort((a, b) => b.priority - a.priority);

    // 如果没有找到外部 IP，添加 localhost
    if (interfaceList.length === 0) {
      interfaceList.push({
        name: 'localhost',
        ip: '127.0.0.1',
        type: 'other',
        priority: 0,
      });
    }

    // 获取请求的 host（可能包含端口）
    const requestHost = request.headers.host || `localhost:${backendPort}`;
    const requestProtocol = request.headers['x-forwarded-proto'] || 'http';

    // 使用优先级最高的IP作为默认
    const defaultIP = interfaceList[0]?.ip || '127.0.0.1';
    const frontendUrl = frontendPort ? `${requestProtocol}://${defaultIP}:${frontendPort}` : null;
    const backendUrl = `${requestProtocol}://${requestHost}`;

    return {
      interfaces: interfaceList,
      defaultIP,
      frontendPort, // 可能为 null，如果前端没有提供
      backendPort,
      frontendUrl, // 可能为 null，如果前端没有提供端口
      backendUrl,
      timestamp: new Date().toISOString(),
    };
  });

  // 测试前端连接
  fastify.get('/api/system/test-connection', async (request, reply) => {
    const { ip, port } = request.query as { ip?: string; port?: string };

    if (!ip) {
      return reply.status(400).send({ error: 'IP address is required' });
    }

    const testPort = port || '13737';
    const testUrl = `http://${ip}:${testPort}`;

    try {
      // 使用 http 模块测试连接（超时 3 秒）
      const http = await import('node:http');

      const result = await new Promise<{ success: boolean; status?: number; message: string }>((resolve) => {
        const timeoutId = setTimeout(() => {
          resolve({
            success: false,
            message: '连接超时',
          });
        }, 3000);

        const req = http.get(testUrl, { timeout: 3000 }, (res) => {
          clearTimeout(timeoutId);
          const statusCode = res.statusCode || 0;
          resolve({
            success: statusCode === 200 || statusCode === 304,
            status: statusCode,
            message: statusCode === 200 || statusCode === 304 ? '连接成功' : '连接失败',
          });
        });

        req.on('error', (error) => {
          clearTimeout(timeoutId);
          resolve({
            success: false,
            message: '连接失败',
          });
        });

        req.on('timeout', () => {
          req.destroy();
          clearTimeout(timeoutId);
          resolve({
            success: false,
            message: '连接超时',
          });
        });
      });

      return {
        success: result.success,
        status: result.status,
        url: testUrl,
        message: result.message,
      };
    } catch (error: any) {
      return {
        success: false,
        url: testUrl,
        message: '连接失败',
        error: error.message,
      };
    }
  });

  // 获取端口信息（只读，仅用于显示）
  fastify.get('/api/system/ports', async (request, reply) => {
    // 前端端口从前端请求头获取
    const frontendPortHeader = request.headers['x-frontend-port'];
    const frontendPort = frontendPortHeader ? parseInt(String(frontendPortHeader), 10) : null;

    return {
      backendPort: BACKEND_PORT, // 从环境变量读取，只读
      frontendPort, // 从前端请求头获取，只读
    };
  });

  // 继续上传重复文件的路由
  fastify.post('/api/upload/continue', async (req, reply) => {
    const { temp_file_path, file_hash, mime_type, original_filename } = req.body as {
      temp_file_path: string;
      file_hash: string;
      mime_type?: string;
      original_filename?: string;
    };

    if (!temp_file_path || !file_hash) {
      return reply.code(400).send({ error: 'Missing required parameters' });
    }

    if (!fs.existsSync(temp_file_path)) {
      return reply.code(404).send({ error: 'Temporary file not found' });
    }

    // 验证文件
    const stats = await fs.promises.stat(temp_file_path);
    if (stats.size === 0) {
      fs.unlinkSync(temp_file_path);
      throw new Error('File upload failed: Empty file');
    }

    // 获取文件信息
    const tempFileName = path.basename(temp_file_path);
    const ext = path.extname(original_filename || tempFileName);
    const originalFilename = original_filename || tempFileName.replace(/^\d+-/, ''); // 移除时间戳前缀

    // 推断mime_type（如果未提供）
    let finalMimeType = mime_type;
    if (!finalMimeType) {
      // 根据扩展名推断
      const extMap: Record<string, string> = {
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.avi': 'video/x-msvideo',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm',
        '.mp3': 'audio/mpeg',
        '.wav': 'audio/wav',
        '.m4a': 'audio/x-m4a',
        '.aac': 'audio/aac',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg'
      };
      finalMimeType = extMap[ext.toLowerCase()] || 'audio/mpeg';
    }

    // 选择最佳存储路径
    const storagePath = StorageService.getBestStoragePath();

    // 生成UUID作为项目ID
    const { randomUUID } = await import('node:crypto');
    const fileId = randomUUID();

    // 使用统一的路径服务创建项目目录并获取最终文件路径
    ProjectPathService.ensureProjectDir(storagePath, fileId);
    const finalFilePath = ProjectPathService.getOriginalFilePath(storagePath, fileId, ext);

    // 插入数据库（使用UUID作为ID，包含file_hash）
    const stmt = db.prepare(`
      INSERT INTO media_files (id, filename, filepath, original_name, mime_type, status, file_hash, size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(fileId, tempFileName, finalFilePath, originalFilename, finalMimeType, 'pending', file_hash, stats.size);

    try {
      fs.renameSync(temp_file_path, finalFilePath);
    } catch (err: any) {
      // 如果移动失败，尝试复制后删除
      fs.copyFileSync(temp_file_path, finalFilePath);
      fs.unlinkSync(temp_file_path);
    }

    // 更新数据库中的文件路径
    db.prepare('UPDATE media_files SET filepath = ? WHERE id = ?').run(finalFilePath, fileId);

    queue.add(fileId, finalFilePath);

    return {
      status: 'success',
      path: finalFilePath,
      filename: tempFileName,
      id: fileId
    };
  });

  // 文件上传路由
  fastify.post('/api/upload', async (req, reply) => {
    const storagePath = StorageService.getBestStoragePath();
    const tempDir = path.join(storagePath, 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    let forceUpload = false;
    let tempFilePath: string | null = null;
    let originalFilename = '';
    let mimetype = '';
    let saved = false;

    try {
      if (typeof req.parts === 'function') {
        const parts = req.parts();
        for await (const part of parts) {
          if (part.type === 'field' && part.fieldname === 'force_upload') {
            const value = part.value;
            const val = typeof value === 'string' ? value : value?.toString?.() ?? '';
            if (val === 'true' || val === '1') {
              forceUpload = true;
            }
          } else if (part.type === 'file') {
            originalFilename = part.filename || `upload-${Date.now()}`;
            mimetype = part.mimetype;

            const ALLOWED_TYPES = [
              'audio/mpeg',
              'audio/wav',
              'audio/x-m4a',
              'audio/mp4',
              'audio/aac',
              'audio/flac',
              'audio/ogg',
              'video/mp4',
              'video/quicktime',
              'video/x-msvideo',
              'video/x-matroska',
              'video/webm'
            ];

            if (!ALLOWED_TYPES.includes(mimetype)) {
              await part.toBuffer();
              return reply.code(400).send({
                error: 'Unsupported file type',
                message: `File type ${mimetype} is not allowed.`,
                allowed: ALLOWED_TYPES
              });
            }

            const timestamp = Date.now();
            const sanitized = path
              .basename(originalFilename)
              .replace(/[^a-zA-Z0-9._-]/g, '_');
            const tempName = `${timestamp}-${sanitized}`;
            tempFilePath = path.join(tempDir, tempName);

            await pipeline(part.file, fs.createWriteStream(tempFilePath));
            console.log(`[Upload] File saved to temporary path ${tempFilePath}`);
            saved = true;
          }
        }
      } else {
        const data = await req.file();
        if (data) {
          originalFilename = data.filename;
          mimetype = data.mimetype;
          const timestamp = Date.now();
          const sanitized = path
            .basename(originalFilename)
            .replace(/[^a-zA-Z0-9._-]/g, '_');
          const tempName = `${timestamp}-${sanitized}`;
          tempFilePath = path.join(tempDir, tempName);
          await pipeline(data.file, fs.createWriteStream(tempFilePath));
          saved = true;
        }
      }
    } catch (err: any) {
      console.error('[Upload] Failed to store file:', err);
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      return reply.code(500).send({ error: 'Upload failed during processing' });
    }

    if (!saved || !tempFilePath) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    const stats = await fs.promises.stat(tempFilePath);
    if (stats.size === 0) {
      fs.unlinkSync(tempFilePath);
      return reply.code(400).send({ error: 'Empty file' });
    }
    console.log(`[Upload] Temporary file ready (${stats.size} bytes): ${tempFilePath}`);

    console.log('[Upload] Calculating file hash...');
    const fileHash = await calculateFileHash(tempFilePath);
    console.log(`[Upload] File hash: ${fileHash}`);

    const existingFile = db.prepare(`
      SELECT id, original_name, display_name, status, created_at, filepath
      FROM media_files
      WHERE file_hash = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(fileHash) as {
      id: string;
      original_name: string;
      display_name: string | null;
      status: string;
      created_at: string;
      filepath: string;
    } | undefined;

    if (existingFile && !forceUpload) {
      console.log(`[Upload] Duplicate file detected: ${existingFile.id}`);
      return {
        status: 'duplicate',
        duplicate: {
          id: existingFile.id,
          name: existingFile.display_name || existingFile.original_name,
          original_name: existingFile.original_name,
          status: existingFile.status,
          created_at: existingFile.created_at,
          filepath: existingFile.filepath
        },
        file_hash: fileHash,
        temp_file_path: tempFilePath,
        mime_type: mimetype,
        original_filename: originalFilename
      };
    }

    const { randomUUID } = await import('node:crypto');
    const fileId = randomUUID();

    const ext = path.extname(originalFilename);
    ProjectPathService.ensureProjectDir(storagePath, fileId);
    const finalFilePath = ProjectPathService.getOriginalFilePath(storagePath, fileId, ext);

    const stmt = db.prepare(`
      INSERT INTO media_files (id, filename, filepath, original_name, mime_type, status, file_hash, size)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const finalFilename = path.basename(tempFilePath);
    stmt.run(fileId, finalFilename, finalFilePath, originalFilename, mimetype, 'pending', fileHash, stats.size);

    try {
      fs.renameSync(tempFilePath, finalFilePath);
    } catch (err: any) {
      fs.copyFileSync(tempFilePath, finalFilePath);
      fs.unlinkSync(tempFilePath);
    }

    db.prepare('UPDATE media_files SET filepath = ? WHERE id = ?').run(finalFilePath, fileId);
    queue.add(fileId, finalFilePath);

    return {
      status: 'success',
      path: finalFilePath,
      filename: finalFilename,
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

    let sql = 'SELECT id, original_name, display_name, status, created_at, filename FROM media_files';
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

    // 获取文件大小
    let fileSize = 0;
    if (file.filepath && fs.existsSync(file.filepath)) {
      try {
        const stats = fs.statSync(file.filepath);
        fileSize = stats.size;
      } catch (e) {
        console.warn(`[API] Failed to get file size for ${file.filepath}:`, e);
      }
    }

    // 获取总结数量
    const summaryCount = db.prepare('SELECT COUNT(*) as count FROM summaries WHERE media_file_id = ?').get(id) as { count: number } | undefined;

    return {
      id: file.id,
      filename: file.filename,
      original_name: file.original_name,
      display_name: file.display_name || null, // ✅ 添加 display_name 字段
      status: file.status,
      created_at: file.created_at,
      duration: file.duration, // ✅ 添加 duration 字段
      mime_type: file.mime_type, // ✅ 添加 mime_type 字段用于判断音频/视频
      audio_path: file.audio_path, // ✅ 添加 audio_path 字段，用于播放提取的音频
      filepath: file.filepath, // ✅ 添加 filepath 字段
      size: fileSize, // ✅ 添加文件大小
      summary_count: summaryCount?.count || 0, // ✅ 添加总结数量
      transcription
    };
  });

  // 更新项目显示名称
  fastify.put('/api/projects/:id/name', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { display_name } = request.body as { display_name: string | null };

    // 验证项目是否存在
    const fileStmt = db.prepare('SELECT id FROM media_files WHERE id = ?');
    const file = fileStmt.get(id) as { id: string } | undefined;

    if (!file) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    // 更新显示名称（允许设置为null以恢复为原始名称）
    const updateStmt = db.prepare('UPDATE media_files SET display_name = ? WHERE id = ?');
    updateStmt.run(display_name || null, id);

    // 返回更新后的项目信息
    const updatedFile = db.prepare('SELECT id, original_name, display_name FROM media_files WHERE id = ?').get(id) as {
      id: number;
      original_name: string;
      display_name: string | null;
    };

    return {
      status: 'success',
      id: updatedFile.id,
      original_name: updatedFile.original_name,
      display_name: updatedFile.display_name
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
    // 使用统一的路径服务删除整个项目目录
    try {
      const basePath = ProjectPathService.parseBasePathFromPath(file.filepath);
      if (basePath) {
        const projectDir = ProjectPathService.getProjectDir(basePath, id);
        if (fs.existsSync(projectDir)) {
          // 删除整个项目目录（包含所有文件）
          await fs.promises.rm(projectDir, { recursive: true, force: true });
          console.log(`[Delete] Project directory deleted: ${projectDir}`);
        }
      } else {
        // 如果无法解析基础路径，回退到删除单个文件
        if (fs.existsSync(file.filepath)) {
          await fs.promises.unlink(file.filepath);
        }
        if (file.audio_path && fs.existsSync(file.audio_path)) {
          await fs.promises.unlink(file.audio_path);
        }
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

  // ========== 存储路径管理 API ==========

  // 获取所有存储路径（含磁盘信息）
  fastify.get('/api/storage/paths', async (request, reply) => {
    try {
      const paths = await StorageService.getAllPathsWithInfo();
      return { status: 'success', paths };
    } catch (error: any) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Failed to get storage paths', details: error.message });
    }
  });

  // 添加存储路径
  fastify.post('/api/storage/paths', async (request, reply) => {
    try {
      const { name, path: dirPath, priority = 0, max_size_gb = null } = request.body as {
        name: string;
        path: string;
        priority?: number;
        max_size_gb?: number | null;
      };

      if (!name || !dirPath) {
        return reply.code(400).send({ error: 'name and path are required' });
      }

      const id = StorageService.addPath(name, dirPath, priority, max_size_gb);
      const pathInfo = StorageService.getPathInfo(id);

      return { status: 'success', path: pathInfo };
    } catch (error: any) {
      request.log.error(error);
      return reply.code(400).send({ error: error.message || 'Failed to add storage path' });
    }
  });

  // 更新存储路径
  fastify.put('/api/storage/paths/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const updates = request.body as {
        name?: string;
        enabled?: boolean;
        priority?: number;
        max_size_gb?: number | null;
      };

      StorageService.updatePath(Number(id), updates);
      const pathInfo = StorageService.getPathInfo(Number(id));

      if (!pathInfo) {
        return reply.code(404).send({ error: 'Storage path not found' });
      }

      return { status: 'success', path: pathInfo };
    } catch (error: any) {
      request.log.error(error);
      return reply.code(400).send({ error: error.message || 'Failed to update storage path' });
    }
  });

  // 删除存储路径
  fastify.delete('/api/storage/paths/:id', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      StorageService.deletePath(Number(id));
      return { status: 'success', message: 'Storage path deleted' };
    } catch (error: any) {
      request.log.error(error);
      return reply.code(400).send({ error: error.message || 'Failed to delete storage path' });
    }
  });

  // 获取指定路径的磁盘信息
  fastify.get('/api/storage/paths/:id/info', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const pathInfo = StorageService.getPathInfo(Number(id));

      if (!pathInfo) {
        return reply.code(404).send({ error: 'Storage path not found' });
      }

      return { status: 'success', path: pathInfo };
    } catch (error: any) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Failed to get storage path info', details: error.message });
    }
  });

  // 检查文件迁移路径（用于前端检测路径是否相同）
  fastify.get('/api/projects/:id/migration-info', async (request, reply) => {
    try {
      const { id } = request.params as { id: string };

      const file = db.prepare('SELECT filepath FROM media_files WHERE id = ?').get(id) as {
        filepath: string;
      } | undefined;

      if (!file || !file.filepath) {
        return reply.code(404).send({ error: 'Project not found or filepath is missing' });
      }

      // 尝试获取当前存储路径ID（可能为null，如果文件不在任何配置的存储路径下）
      let currentPathId: number | null = null;
      let currentPath: any = null;
      let isProjectStructure = false; // 是否为项目目录结构

      try {
        // 检查文件是否已经是项目目录结构
        isProjectStructure = ProjectPathService.isProjectPath(file.filepath);

        currentPathId = StorageService.getFileStoragePathId(file.filepath);
        if (currentPathId !== null) {
          const pathRecord = db.prepare('SELECT * FROM storage_paths WHERE id = ?').get(currentPathId) as any;
          if (pathRecord) {
            currentPath = {
              id: pathRecord.id,
              name: pathRecord.name,
              path: pathRecord.path
            };
          }
        }
      } catch (err: any) {
        // 如果获取路径信息失败（可能是旧数据或路径配置问题），不影响返回
        request.log.warn(`Failed to get storage path info for project ${id}:`, err);
      }

      return {
        status: 'success',
        currentPathId: currentPathId ?? null,
        currentPath: currentPath ?? null,
        isProjectStructure // 返回是否为项目目录结构
      };
    } catch (error: any) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Failed to get migration info', details: error.message });
    }
  });

  // 迁移文件
  fastify.post('/api/storage/migrate', async (request, reply) => {
    try {
      const { file_ids, target_path_id, delete_source = false } = request.body as {
        file_ids: string[];
        target_path_id: number;
        delete_source?: boolean;
      };

      if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
        return reply.code(400).send({ error: 'file_ids is required and must be a non-empty array' });
      }

      if (!target_path_id) {
        return reply.code(400).send({ error: 'target_path_id is required' });
      }

      // 执行批量迁移
      const result = await StorageService.migrateFiles(file_ids, target_path_id, {
        deleteSource: delete_source
      });

      return {
        status: 'success',
        ...result
      };
    } catch (error: any) {
      request.log.error(error);
      return reply.code(500).send({ error: 'Failed to migrate files', details: error.message });
    }
  });

  return fastify;
};

// 启动服务
const start = async () => {
  // 执行依赖检查
  console.log('Checking dependencies...');
  const checkResults = await DependencyChecker.checkAll();
  DependencyChecker.printResults(checkResults);

  // 如果有致命错误，可以选择退出或继续启动
  if (DependencyChecker.hasCriticalErrors(checkResults)) {
    console.log('⚠️  Critical dependencies are missing. Service will start but may not work properly.');
    console.log('Press Ctrl+C to exit, or wait 5 seconds to continue anyway...\n');

    // 等待 5 秒，给用户时间取消
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  const fastify = buildApp();
  try {
    await fastify.listen({ port: BACKEND_PORT, host: '0.0.0.0' });
    console.log(`\n✓ Server listening at http://localhost:${BACKEND_PORT}`);
    console.log(`Backend port is configured via BACKEND_PORT environment variable (current: ${BACKEND_PORT})`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}
