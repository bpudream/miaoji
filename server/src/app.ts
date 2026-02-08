import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import db from './db';
import queue from './queue';
import { getPrompts, SummaryMode } from './ai/prompts';
import { LLMFactory } from './ai/factory';
import { getLLMConfig, getLLMConfigForAPI, setLLMConfig } from './services/config';
import { startStreamTranslationScheduler } from './services/translation';
import { StorageService } from './services/storage';
import { ProjectPathService } from './services/projectPath';
import { calculateFileHash } from './services/fileHash';
import { DependencyChecker } from './services/dependencyCheck';
import { createLoggerConfig, logger } from './utils/logger';
import { startLogCleanupScheduler } from './utils/logCleanup';
import { buildSrt, buildVtt } from './utils/subtitle';
import { normalizeScenario, buildPrompt, buildPromptWithMeta, type ScenarioKey } from './services/whisperPrompt';

// 从环境变量读取配置
const BACKEND_PORT = parseInt(process.env.BACKEND_PORT || '3000', 10);
const UPLOAD_MAX_SIZE_BYTES = (() => {
  const bytes = process.env.UPLOAD_MAX_SIZE_BYTES ? parseInt(process.env.UPLOAD_MAX_SIZE_BYTES, 10) : NaN;
  if (!Number.isNaN(bytes) && bytes > 0) {
    return bytes;
  }
  const gb = process.env.UPLOAD_MAX_SIZE_GB ? parseFloat(process.env.UPLOAD_MAX_SIZE_GB) : NaN;
  if (!Number.isNaN(gb) && gb > 0) {
    return Math.floor(gb * 1024 * 1024 * 1024);
  }
  return 4 * 1024 * 1024 * 1024;
})();

const ALLOWED_MIME_TYPES = [
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

const EXT_MIME_MAP: Record<string, string> = {
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

export const buildApp = () => {
  // 使用新的日志配置
  const loggerConfig = createLoggerConfig();

  const fastify = Fastify({
    logger: loggerConfig,
    requestIdLogLabel: 'requestId', // 请求ID的标签
    genReqId: () => randomUUID(), // 生成请求ID
  });

  // 添加请求ID追踪中间件
  fastify.addHook('onRequest', async (request, reply) => {
    // 请求ID已经由 Fastify 自动生成并添加到 request.id
    // 记录请求开始时间
    (request as any).startTime = Date.now();
    request.log.info({
      method: request.method,
      url: request.url,
      ip: request.ip,
      userAgent: request.headers['user-agent'],
    }, 'Incoming request');
  });

  // 添加响应日志中间件
  fastify.addHook('onResponse', async (request, reply) => {
    const startTime = (request as any).startTime || Date.now();
    const responseTime = Date.now() - startTime;
    request.log.info({
      method: request.method,
      url: request.url,
      statusCode: reply.statusCode,
      responseTime: `${responseTime}ms`,
    }, 'Request completed');
  });

  // 注册插件
  fastify.register(cors, {
    origin: true, // 允许所有来源，开发阶段方便
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  fastify.register(multipart, {
    limits: {
      fileSize: UPLOAD_MAX_SIZE_BYTES,
    }
  });

  // 全局错误处理
  fastify.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    const errorCode = (error as any).code;
    const isFileTooLarge =
      errorCode === 'FST_REQ_FILE_TOO_LARGE' ||
      errorCode === 'FST_PART_FILE_TOO_LARGE' ||
      errorCode === 'LIMIT_FILE_SIZE';
    if (isFileTooLarge) {
      return reply.status(413).send({
        error: 'FileTooLarge',
        message: `文件超过大小限制（最大 ${Math.round(UPLOAD_MAX_SIZE_BYTES / 1024 / 1024 / 1024)}GB）`,
        statusCode: 413
      });
    }
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

  const setSetting = (key: string, value: string) => {
    db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    ).run(key, value);
  };

  const getBooleanSetting = (key: string, defaultValue: boolean): boolean => {
    const value = getSetting(key, defaultValue ? 'true' : 'false');
    return value === 'true' || value === '1';
  };

  const getLocalModeConfig = () => {
    const envLocalMode = process.env.LOCAL_MODE;
    const localModeSource = envLocalMode != null ? 'env' : 'settings';
    const localMode = envLocalMode != null
      ? (envLocalMode === 'true' || envLocalMode === '1')
      : getBooleanSetting('local_mode', false);

    const rawAllowedEnv = process.env.LOCAL_MODE_ALLOWED_BASE_PATHS;
    const allowedBasePathsSource = rawAllowedEnv != null ? 'env' : 'settings';
    const rawAllowed = rawAllowedEnv != null
      ? rawAllowedEnv
      : getSetting('local_mode_allowed_base_paths', '');
    const allowedBasePaths = rawAllowed
      .split(',')
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => path.resolve(p));

    return { localMode, allowedBasePaths, localModeSource, allowedBasePathsSource };
  };

  const normalizePathForCompare = (targetPath: string): string => {
    const normalized = path.resolve(targetPath);
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  };

  const isPathWithin = (targetPath: string, basePath: string): boolean => {
    const relativePath = path.relative(basePath, targetPath);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
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

    const { localMode, allowedBasePaths, localModeSource, allowedBasePathsSource } = getLocalModeConfig();

    return {
      interfaces: interfaceList,
      defaultIP,
      frontendPort, // 可能为 null，如果前端没有提供
      backendPort,
      frontendUrl, // 可能为 null，如果前端没有提供端口
      backendUrl,
      timestamp: new Date().toISOString(),
      localMode,
      localModeAllowedBasePaths: allowedBasePaths,
      localModeSource,
      localModeAllowedBasePathsSource: allowedBasePathsSource,
      uploadMaxSizeBytes: UPLOAD_MAX_SIZE_BYTES,
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

  // 本地模式设置
  fastify.get('/api/settings/local-mode', async (_request, _reply) => {
    const { localMode, allowedBasePaths, localModeSource, allowedBasePathsSource } = getLocalModeConfig();
    return {
      localMode,
      allowedBasePaths,
      localModeSource,
      allowedBasePathsSource,
    };
  });

  fastify.put('/api/settings/local-mode', async (request, reply) => {
    const body = request.body as {
      localMode?: boolean;
      allowedBasePaths?: string[];
    };
    const { localModeSource, allowedBasePathsSource } = getLocalModeConfig();

    if (body.localMode !== undefined && localModeSource === 'env') {
      return reply.code(409).send({ error: 'Local mode is controlled by env LOCAL_MODE' });
    }
    if (body.allowedBasePaths !== undefined && allowedBasePathsSource === 'env') {
      return reply.code(409).send({ error: 'Allowed paths are controlled by env LOCAL_MODE_ALLOWED_BASE_PATHS' });
    }

    if (body.localMode !== undefined) {
      setSetting('local_mode', body.localMode ? 'true' : 'false');
    }
    if (body.allowedBasePaths !== undefined) {
      const cleaned = body.allowedBasePaths
        .map(p => String(p).trim())
        .filter(Boolean)
        .join(',');
      setSetting('local_mode_allowed_base_paths', cleaned);
    }

    const updated = getLocalModeConfig();
    return {
      localMode: updated.localMode,
      allowedBasePaths: updated.allowedBasePaths,
      localModeSource: updated.localModeSource,
      allowedBasePathsSource: updated.allowedBasePathsSource,
    };
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

  // ========== LLM 设置 API ==========
  // 获取 LLM 配置（脱敏，不含 api_key 明文）
  fastify.get('/api/settings/llm', async (request, reply) => {
    const config = getLLMConfigForAPI();
    return config ?? {
      provider: 'ollama',
      base_url: 'http://localhost:11434',
      model_name: 'qwen3:14b',
      translation_chunk_tokens: 1200,
      translation_overlap_tokens: 200,
      translation_context_tokens: 4096,
      translation_stream_batch_size: 5,
      translation_stream_context_lines: 3,
      api_key_set: false,
    };
  });

  // 更新 LLM 配置
  fastify.post('/api/settings/llm', async (request, reply) => {
    const body = request.body as {
      provider?: string;
      base_url?: string;
      model_name?: string;
      api_key?: string;
      translation_chunk_tokens?: number;
      translation_overlap_tokens?: number;
      translation_context_tokens?: number;
      translation_stream_batch_size?: number;
      translation_stream_context_lines?: number;
    };
    const provider = body.provider as 'ollama' | 'openai' | undefined;
    if (!provider || !['ollama', 'openai'].includes(provider)) {
      return reply.code(400).send({ error: 'Invalid or missing provider. Must be ollama or openai.' });
    }
    const current = getLLMConfig();
    if (provider === 'openai' && !(current?.api_key) && !(body.api_key?.trim())) {
      return reply.code(400).send({ error: 'API Key is required for OpenAI/DeepSeek provider.' });
    }
    const payload: Parameters<typeof setLLMConfig>[0] = { provider };
    if (body.base_url !== undefined) payload.base_url = body.base_url;
    if (body.model_name !== undefined) payload.model_name = body.model_name;
    if (body.translation_chunk_tokens !== undefined) {
      payload.translation_chunk_tokens = body.translation_chunk_tokens;
    }
    if (body.translation_overlap_tokens !== undefined) {
      payload.translation_overlap_tokens = body.translation_overlap_tokens;
    }
    if (body.translation_context_tokens !== undefined) {
      payload.translation_context_tokens = body.translation_context_tokens;
    }
    if (body.translation_stream_batch_size !== undefined) {
      payload.translation_stream_batch_size = body.translation_stream_batch_size;
    }
    if (body.translation_stream_context_lines !== undefined) {
      payload.translation_stream_context_lines = body.translation_stream_context_lines;
    }
    if (body.api_key !== undefined) payload.api_key = body.api_key;
    setLLMConfig(payload);
    const updated = getLLMConfigForAPI();
    return { status: 'success', config: updated };
  });

  // 测试 LLM 连接
  fastify.post('/api/settings/llm/test', async (request, reply) => {
    const config = getLLMConfig();
    const provider = config ? LLMFactory.create(config) : null;
    if (!provider) {
      return reply.code(400).send({ success: false, message: '未配置有效的 LLM，请先选择 Provider 并填写必要信息。' });
    }
    try {
      const ok = await provider.checkHealth();
      return { success: ok, message: ok ? '连接成功' : '连接失败，请检查地址与 API Key。' };
    } catch (err: any) {
      request.log.error(err);
      return reply.code(200).send({ success: false, message: err?.message || '连接测试失败' });
    }
  });

  // 本地路径创建项目（本地模式）
  fastify.post('/api/projects/from-local-path', async (req, reply) => {
    const { localMode, allowedBasePaths } = getLocalModeConfig();
    if (!localMode) {
      return reply.code(403).send({ error: 'Local mode is disabled' });
    }

    const { path: inputPath, display_name } = req.body as {
      path?: string;
      display_name?: string;
    };

    if (!inputPath || !String(inputPath).trim()) {
      return reply.code(400).send({ error: 'Missing required path' });
    }

    const trimmedPath = String(inputPath).trim();
    const resolvedPath = path.resolve(trimmedPath);

    if (!fs.existsSync(resolvedPath)) {
      return reply.code(404).send({ error: 'File not found' });
    }

    const realPath = fs.realpathSync(resolvedPath);

    if (allowedBasePaths.length > 0) {
      const normalizedTarget = normalizePathForCompare(realPath);
      const isAllowed = allowedBasePaths.some(base => {
        const normalizedBase = normalizePathForCompare(base);
        return isPathWithin(normalizedTarget, normalizedBase);
      });
      if (!isAllowed) {
        return reply.code(400).send({ error: 'Path is not within allowed base paths' });
      }
    }

    const stats = fs.statSync(realPath);
    if (!stats.isFile()) {
      return reply.code(400).send({ error: 'Path is not a file' });
    }

    const ext = path.extname(realPath).toLowerCase();
    const mimeType = EXT_MIME_MAP[ext];
    if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
      return reply.code(400).send({
        error: 'Unsupported file type',
        message: `File extension ${ext} is not allowed.`,
        allowed: ALLOWED_MIME_TYPES
      });
    }

    const { randomUUID } = await import('node:crypto');
    const fileId = randomUUID();
    const basename = path.basename(realPath);
    const displayName = display_name ? String(display_name).trim() : '';

    const stmt = db.prepare(`
      INSERT INTO media_files (id, filename, filepath, original_name, mime_type, status, file_hash, size, scenario)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      fileId,
      basename,
      realPath,
      basename,
      mimeType,
      'waiting_extract',
      null,
      stats.size,
      null
    );

    if (displayName) {
      db.prepare('UPDATE media_files SET display_name = ? WHERE id = ?').run(displayName, fileId);
    }

    queue.add('extract', { id: fileId, filepath: realPath });

    return {
      status: 'success',
      path: realPath,
      filename: basename,
      id: fileId
    };
  });

  // 继续上传重复文件的路由
  fastify.post('/api/upload/continue', async (req, reply) => {
    const { temp_file_path, file_hash, mime_type, original_filename, scenario } = req.body as {
      temp_file_path: string;
      file_hash: string;
      mime_type?: string;
      original_filename?: string;
      scenario?: string;
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
      INSERT INTO media_files (id, filename, filepath, original_name, mime_type, status, file_hash, size, scenario)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const scenarioKey = (scenario != null && String(scenario).trim() !== '') ? normalizeScenario(scenario) : null;
    stmt.run(
      fileId,
      tempFileName,
      finalFilePath,
      originalFilename,
      finalMimeType,
      'waiting_extract',
      file_hash,
      stats.size,
      scenarioKey
    );

    try {
      fs.renameSync(temp_file_path, finalFilePath);
    } catch (err: any) {
      // 如果移动失败，尝试复制后删除
      fs.copyFileSync(temp_file_path, finalFilePath);
      fs.unlinkSync(temp_file_path);
    }

    // 更新数据库中的文件路径
    db.prepare('UPDATE media_files SET filepath = ? WHERE id = ?').run(finalFilePath, fileId);

    queue.add('extract', { id: fileId, filepath: finalFilePath });

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
    let scenario: string | null = null;
    let tempFilePath: string | null = null;
    let originalFilename = '';
    let mimetype = '';
    let saved = false;
    let fileTruncated = false;

    try {
      if (typeof req.parts === 'function') {
        const parts = req.parts();
        for await (const part of parts) {
          if (part.type === 'field') {
            const value = part.value;
            const val = typeof value === 'string' ? value : value?.toString?.() ?? '';
            if (part.fieldname === 'force_upload') {
              if (val === 'true' || val === '1') {
                forceUpload = true;
              }
            } else if (part.fieldname === 'scenario') {
              scenario = val.trim() || null;
            }
          } else if (part.type === 'file') {
            originalFilename = part.filename || `upload-${Date.now()}`;
            mimetype = part.mimetype;

            if (!ALLOWED_MIME_TYPES.includes(mimetype)) {
              await part.toBuffer();
              return reply.code(400).send({
                error: 'Unsupported file type',
                message: `File type ${mimetype} is not allowed.`,
                allowed: ALLOWED_MIME_TYPES
              });
            }

            const timestamp = Date.now();
            const sanitized = path
              .basename(originalFilename)
              .replace(/[^a-zA-Z0-9._-]/g, '_');
            const tempName = `${timestamp}-${sanitized}`;
            tempFilePath = path.join(tempDir, tempName);

            await pipeline(part.file, fs.createWriteStream(tempFilePath));
            if ((part.file as any).truncated) {
              fileTruncated = true;
            }
            req.log.info({ tempFilePath, filename: originalFilename }, 'File saved to temporary path');
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
          if ((data.file as any).truncated) {
            fileTruncated = true;
          }
          saved = true;
        }
      }
    } catch (err: any) {
      req.log.error({ err, tempFilePath }, 'Failed to store file');
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      return reply.code(500).send({ error: 'Upload failed during processing' });
    }

    if (!saved || !tempFilePath) {
      return reply.code(400).send({ error: 'No file uploaded' });
    }

    if (fileTruncated) {
      if (tempFilePath && fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath);
      }
      return reply.code(413).send({
        error: 'FileTooLarge',
        message: `文件超过大小限制（最大 ${Math.round(UPLOAD_MAX_SIZE_BYTES / 1024 / 1024 / 1024)}GB）`
      });
    }

    const stats = await fs.promises.stat(tempFilePath);
    if (stats.size === 0) {
      fs.unlinkSync(tempFilePath);
      return reply.code(400).send({ error: 'Empty file' });
    }
    req.log.info({ size: stats.size, tempFilePath }, 'Temporary file ready');

    req.log.debug('Calculating file hash...');
    const fileHash = await calculateFileHash(tempFilePath);
    req.log.debug({ fileHash }, 'File hash calculated');

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
      req.log.info({ existingFileId: existingFile.id, fileHash }, 'Duplicate file detected');
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
      INSERT INTO media_files (id, filename, filepath, original_name, mime_type, status, file_hash, size, scenario)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const finalFilename = path.basename(tempFilePath);
    const scenarioKey = (scenario != null && String(scenario).trim() !== '') ? normalizeScenario(scenario) : null;
    stmt.run(
      fileId,
      finalFilename,
      finalFilePath,
      originalFilename,
      mimetype,
      'waiting_extract',
      fileHash,
      stats.size,
      scenarioKey
    );

    try {
      fs.renameSync(tempFilePath, finalFilePath);
    } catch (err: any) {
      fs.copyFileSync(tempFilePath, finalFilePath);
      fs.unlinkSync(tempFilePath);
    }

    db.prepare('UPDATE media_files SET filepath = ? WHERE id = ?').run(finalFilePath, fileId);

    queue.add('extract', { id: fileId, filepath: finalFilePath });

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

    return {
      id: file.id,
      filename: file.filename,
      original_name: file.original_name,
      status: file.status, // pending, processing, completed, error
      created_at: file.created_at,
      transcription_started_at: file.transcription_started_at ?? null,
      transcription_first_segment_at: file.transcription_first_segment_at ?? null,
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

    if (existingTrans?.id != null) {
      const deleteTx = db.transaction(() => {
        db.prepare('DELETE FROM translation_segments WHERE transcription_id = ?').run(existingTrans.id);
        db.prepare('DELETE FROM transcription_segments WHERE transcription_id = ?').run(existingTrans.id);
        const insertStmt = db.prepare(
          `INSERT INTO transcription_segments (transcription_id, segment_index, start_time, end_time, text)
           VALUES (?, ?, ?, ?, ?)`
        );
        segments.forEach((seg: any, idx: number) => {
          const start = Number(seg.start ?? 0);
          const end = Number(seg.end ?? 0);
          const text = String(seg.text ?? '');
          insertStmt.run(existingTrans.id, idx, start, end, text);
        });
      });
      deleteTx();
    }

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

    request.log.debug({ projectId: id, status: file.status }, 'Getting project details');

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
        request.log.debug({ projectId: id, format: result.format }, 'Fetched transcription');
      } catch (e) {
        request.log.error({ projectId: id, err: e }, 'Failed to parse transcription content');
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
        request.log.warn({ filepath: file.filepath, err: e }, 'Failed to get file size');
      }
    }

    // 获取总结数量
    const summaryCount = db.prepare('SELECT COUNT(*) as count FROM summaries WHERE media_file_id = ?').get(id) as { count: number } | undefined;

    return {
      id: file.id,
      filename: file.filename,
      original_name: file.original_name,
      display_name: file.display_name || null, // ✅ 添加 display_name 字段
      scenario: file.scenario || null,
      status: file.status,
      created_at: file.created_at,
      duration: file.duration, // ✅ 添加 duration 字段
      mime_type: file.mime_type, // ✅ 添加 mime_type 字段用于判断音频/视频
      audio_path: file.audio_path, // ✅ 添加 audio_path 字段，用于播放提取的音频
      filepath: file.filepath, // ✅ 添加 filepath 字段
      size: fileSize, // ✅ 添加文件大小
      summary_count: summaryCount?.count || 0, // ✅ 添加总结数量
      transcription_progress: file.transcription_progress != null ? file.transcription_progress : null, // 转写中时 0–100
      transcription_started_at: file.transcription_started_at ?? null,
      transcription_first_segment_at: file.transcription_first_segment_at ?? null,
      transcription
    };
  });

  // 手动触发转写（请求体可带 scenario、meta：主队/客队/自定义关键词）
  fastify.post('/api/projects/:id/transcribe', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as {
      scenario?: string;
      meta?: {
        team_home_id?: string;
        team_away_id?: string;
        keywords?: string;
        roster_mode?: 'none' | 'full' | 'starting';
        selected_players?: string[];
      };
    }) || {};

    const fileStmt = db.prepare('SELECT * FROM media_files WHERE id = ?');
    const file = fileStmt.get(id) as any;

    if (!file) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    if (['waiting_extract', 'extracting', 'transcribing', 'processing'].includes(file.status)) {
      return reply.code(400).send({ error: 'Project is already processing' });
    }

    if (!file.filepath) {
      return reply.code(400).send({ error: 'Project file path not found' });
    }

    if (!['ready_to_transcribe', 'error', 'completed', 'cancelled'].includes(file.status)) {
      return reply.code(400).send({ error: 'Project is not ready for transcription' });
    }

    if (!file.audio_path || !fs.existsSync(file.audio_path)) {
      return reply.code(400).send({ error: 'Audio is not extracted yet' });
    }

    const meta = body.meta;
    const teamHomeId = meta?.team_home_id?.trim() || null;
    const teamAwayId = meta?.team_away_id?.trim() || null;
    const keywords = meta?.keywords != null ? String(meta.keywords).trim() : null;
    const rosterMode = meta?.roster_mode === 'none' || meta?.roster_mode === 'full' || meta?.roster_mode === 'starting'
      ? meta.roster_mode
      : undefined;
    const selectedPlayers = Array.isArray(meta?.selected_players)
      ? meta?.selected_players.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim())
      : undefined;

    if (teamHomeId || teamAwayId) {
      const teamStmt = db.prepare('SELECT id FROM teams WHERE id = ?');
      if (teamHomeId && !teamStmt.get(teamHomeId)) {
        return reply.code(400).send({ error: 'Team not found', details: 'team_home_id' });
      }
      if (teamAwayId && !teamStmt.get(teamAwayId)) {
        return reply.code(400).send({ error: 'Team not found', details: 'team_away_id' });
      }
    }

    const transcribeMeta =
      teamHomeId || teamAwayId || keywords || rosterMode || (selectedPlayers && selectedPlayers.length > 0)
        ? JSON.stringify({
            team_home_id: teamHomeId || undefined,
            team_away_id: teamAwayId || undefined,
            keywords: keywords || undefined,
            roster_mode: rosterMode,
            selected_players: selectedPlayers && selectedPlayers.length > 0 ? selectedPlayers : undefined
          })
        : null;

    const scenarioValue =
      body.scenario != null && String(body.scenario).trim() !== ''
        ? normalizeScenario(body.scenario)
        : (file.scenario ?? null);

    db.prepare(`
      UPDATE media_files
      SET scenario = ?, transcribe_meta = ?, status = 'pending', error_message = NULL, failed_stage = NULL, transcription_progress = NULL
      WHERE id = ?
    `).run(scenarioValue, transcribeMeta, id);

    // 清理旧的转写与总结，避免历史数据干扰
    db.prepare('DELETE FROM translation_segments WHERE transcription_id IN (SELECT id FROM transcriptions WHERE media_file_id = ?)').run(id);
    db.prepare('DELETE FROM transcription_segments WHERE transcription_id IN (SELECT id FROM transcriptions WHERE media_file_id = ?)').run(id);
    db.prepare('DELETE FROM transcriptions WHERE media_file_id = ?').run(id);
    db.prepare('DELETE FROM summaries WHERE media_file_id = ?').run(id);

    queue.add('transcribe', { id: file.id, filepath: file.filepath });

    return { status: 'success', message: 'Task queued for transcription' };
  });

  // 转写提示词预览（与 transcribe 使用相同逻辑，仅返回拼接后的 prompt）
  fastify.post('/api/projects/:id/transcribe-preview', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as {
      scenario?: string;
      meta?: {
        team_home_id?: string;
        team_away_id?: string;
        keywords?: string;
        roster_mode?: 'none' | 'full' | 'starting';
        selected_players?: string[];
      };
    }) || {};

    const file = db.prepare('SELECT original_name, display_name FROM media_files WHERE id = ?').get(id) as
      | { original_name?: string; display_name?: string | null }
      | undefined;
    if (!file) {
      return reply.code(404).send({ error: 'Project not found' });
    }

    const scenarioKey = normalizeScenario(body.scenario) as ScenarioKey;
    const filename = (file.display_name && String(file.display_name).trim()) || (file.original_name && String(file.original_name).trim()) || '';

    const meta = body.meta;
    const teamHomeId = meta?.team_home_id?.trim();
    const teamAwayId = meta?.team_away_id?.trim();
    const keywords = meta?.keywords != null ? String(meta.keywords).trim() : undefined;
    const rosterMode = meta?.roster_mode === 'none' || meta?.roster_mode === 'full' || meta?.roster_mode === 'starting'
      ? meta.roster_mode
      : 'full';
    const selectedPlayers = Array.isArray(meta?.selected_players)
      ? meta?.selected_players.filter((v) => typeof v === 'string' && v.trim()).map((v) => v.trim())
      : undefined;

    const rosterParts: string[] = [];
    let teamHomeName: string | undefined;
    let teamAwayName: string | undefined;

    const useRoster = rosterMode !== 'none';
    const useStarting = rosterMode === 'starting';

    if (teamHomeId && useRoster) {
      const row = db.prepare('SELECT name, roster_text FROM teams WHERE id = ?').get(teamHomeId) as
        | { name: string; roster_text: string | null }
        | undefined;
      if (row) {
        teamHomeName = row.name;
        if (!useStarting && row.roster_text?.trim()) rosterParts.push(row.roster_text.trim());
      }
    }
    if (teamAwayId && useRoster) {
      const row = db.prepare('SELECT name, roster_text FROM teams WHERE id = ?').get(teamAwayId) as
        | { name: string; roster_text: string | null }
        | undefined;
      if (row) {
        teamAwayName = row.name;
        if (!useStarting && row.roster_text?.trim()) rosterParts.push(row.roster_text.trim());
      }
    }
    if (useStarting && selectedPlayers && selectedPlayers.length > 0) {
      rosterParts.push(selectedPlayers.join(', '));
    }

    const roster_combined =
      rosterParts.length > 0
        ? rosterParts.join(', ').replace(/\s+/g, ' ').replace(/,+/g, ',').trim()
        : undefined;

    const buildPromptMeta: { team_home_name?: string; team_away_name?: string; roster_combined?: string; keywords?: string } | undefined =
      teamHomeName || teamAwayName || roster_combined || keywords
        ? {}
        : undefined;
    if (buildPromptMeta) {
      if (teamHomeName) buildPromptMeta.team_home_name = teamHomeName;
      if (teamAwayName) buildPromptMeta.team_away_name = teamAwayName;
      if (roster_combined) buildPromptMeta.roster_combined = roster_combined;
      if (keywords) buildPromptMeta.keywords = keywords;
    }

    const result = buildPromptWithMeta(filename, scenarioKey, buildPromptMeta);
    return reply.send({ prompt: result.prompt, truncated: result.truncated, keywords_truncated: result.keywords_truncated });
  });

  // ========== 球队名单 API（转写提示词增强） ==========

  fastify.get('/api/teams', async (_request, reply) => {
    const rows = db.prepare('SELECT id, name, roster_text, starting_lineup_text, created_at FROM teams ORDER BY created_at DESC').all() as any[];
    return reply.send(rows);
  });

  fastify.post('/api/teams', async (request, reply) => {
    const body = request.body as { name?: string; roster_text?: string; starting_lineup_text?: string };
    const name = body.name != null ? String(body.name).trim() : '';
    const rosterText = body.roster_text != null ? String(body.roster_text).trim() : null;
    const startingLineupText = body.starting_lineup_text != null ? String(body.starting_lineup_text).trim() : null;
    if (!name) {
      return reply.code(400).send({ error: 'name is required' });
    }
    const id = randomUUID();
    db.prepare('INSERT INTO teams (id, name, roster_text, starting_lineup_text) VALUES (?, ?, ?, ?)').run(id, name, rosterText, startingLineupText);
    const row = db.prepare('SELECT id, name, roster_text, starting_lineup_text, created_at FROM teams WHERE id = ?').get(id) as any;
    return reply.code(201).send(row);
  });

  fastify.put('/api/teams/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { name?: string; roster_text?: string; starting_lineup_text?: string };
    const existing = db.prepare('SELECT id FROM teams WHERE id = ?').get(id);
    if (!existing) {
      return reply.code(404).send({ error: 'Team not found' });
    }
    const name = body.name != null ? String(body.name).trim() : undefined;
    const rosterText = body.roster_text !== undefined ? String(body.roster_text).trim() : undefined;
    const startingLineupText = body.starting_lineup_text !== undefined ? String(body.starting_lineup_text).trim() : undefined;
    if (name !== undefined) {
      if (!name) return reply.code(400).send({ error: 'name cannot be empty' });
      db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(name, id);
    }
    if (rosterText !== undefined) {
      db.prepare('UPDATE teams SET roster_text = ? WHERE id = ?').run(rosterText || null, id);
    }
    if (startingLineupText !== undefined) {
      db.prepare('UPDATE teams SET starting_lineup_text = ? WHERE id = ?').run(startingLineupText || null, id);
    }
    const row = db.prepare('SELECT id, name, roster_text, starting_lineup_text, created_at FROM teams WHERE id = ?').get(id) as any;
    return reply.send(row);
  });

  fastify.delete('/api/teams/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = db.prepare('DELETE FROM teams WHERE id = ?').run(id);
    if (result.changes === 0) {
      return reply.code(404).send({ error: 'Team not found' });
    }
    return reply.send({ status: 'success' });
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
      // 2. 获取当前 LLM 配置并创建 Provider
      const llmConfig = getLLMConfig();
      const provider = llmConfig ? LLMFactory.create(llmConfig) : null;
      if (!llmConfig || !provider) {
        return reply.code(503).send({ error: '未配置 LLM。请在设置中选择“本地模型”或“在线模型”并保存。' });
      }
      const isHealthy = await provider.checkHealth();
      if (!isHealthy) {
        const hint = llmConfig.provider === 'ollama'
          ? 'Ollama 服务不可用，请确认已启动 Ollama。'
          : '在线模型连接失败，请检查 API Key 与网络。';
        return reply.code(503).send({ error: hint });
      }

      // 3. 生成 Prompt（与 Provider 无关的模板）
      const { prompt, system } = getPrompts(fullText, mode);
      const messages = [
        { role: 'system' as const, content: system },
        { role: 'user' as const, content: prompt },
      ];

      // 4. 调用当前 Provider 生成总结
      const summaryText = await provider.chat(messages);

      // 5. 保存到数据库（记录当前使用的模型名）
      const modelLabel = llmConfig.model_name || (llmConfig.provider === 'ollama' ? 'qwen3:14b' : 'openai');
      const insertStmt = db.prepare(`
        INSERT INTO summaries (media_file_id, content, model, mode)
        VALUES (?, ?, ?, ?)
      `);
      insertStmt.run(id, summaryText, modelLabel, mode);

      return {
        status: 'success',
        summary: summaryText,
        mode,
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

  // 提交翻译任务入队
  fastify.post('/api/projects/:id/translate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { target_language = 'en' } = (request.body as { target_language?: string }) ?? {};
    const file = db.prepare('SELECT id FROM media_files WHERE id = ?').get(id) as { id: string } | undefined;
    if (!file) {
      return reply.code(404).send({ error: 'Project not found' });
    }
    const trans = db.prepare('SELECT id FROM transcriptions WHERE media_file_id = ?').get(id);
    if (!trans) {
      return reply.code(400).send({ error: 'No transcription available for this project' });
    }
    queue.add('translate', { id, target_language });
    return reply.code(202).send({ status: 'accepted', message: 'Translation task queued', target_language });
  });

  // 获取某项目的某语言翻译结果
  fastify.get('/api/projects/:id/translations', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { language = 'en' } = request.query as { language?: string };
    const trans = db.prepare('SELECT id FROM transcriptions WHERE media_file_id = ?').get(id) as { id: number } | undefined;
    if (!trans) {
      return reply.code(404).send({ error: 'Transcription not found' });
    }
    const row = db
      .prepare(
        'SELECT id, transcription_id, language, content, status, progress, total_chunks, completed_chunks, started_at, updated_at, created_at FROM translations WHERE transcription_id = ? AND language = ?'
      )
      .get(trans.id, language) as any;
    if (!row) {
      return reply.code(404).send({ error: 'Translation not found for this language' });
    }
    let content: any = null;
    if (row.content) {
      try {
        content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content;
      } catch {
        content = null;
      }
    }
    return {
      id: row.id,
      transcription_id: row.transcription_id,
      language: row.language,
      content,
      status: row.status,
      progress: row.progress,
      total_chunks: row.total_chunks,
      completed_chunks: row.completed_chunks,
      started_at: row.started_at,
      updated_at: row.updated_at,
      created_at: row.created_at,
    };
  });

  // 获取流式转写段落（可拼接对应译文）
  fastify.get('/api/projects/:id/transcription/segments', async (request, reply) => {
    const { id } = request.params as { id: string };
    const { language = 'zh' } = request.query as { language?: string };
    const trans = db.prepare('SELECT id FROM transcriptions WHERE media_file_id = ?').get(id) as { id: number } | undefined;
    if (!trans) {
      return reply.code(404).send({ error: 'Transcription not found' });
    }
    const rows = db.prepare(
      `SELECT ts.segment_index, ts.start_time, ts.end_time, ts.text as original_text, tls.text as translated_text
       FROM transcription_segments ts
       LEFT JOIN translation_segments tls
         ON ts.transcription_id = tls.transcription_id
        AND ts.segment_index = tls.segment_index
        AND tls.language = ?
       WHERE ts.transcription_id = ?
       ORDER BY ts.segment_index ASC`
    ).all(language, trans.id) as Array<{
      segment_index: number;
      start_time: number;
      end_time: number;
      original_text: string;
      translated_text: string | null;
    }>;
    return rows.map((row) => ({
      index: row.segment_index,
      start: row.start_time,
      end: row.end_time,
      original: row.original_text,
      translation: row.translated_text ?? null,
    }));
  });

  // 开启/关闭同步翻译
  fastify.post('/api/projects/:id/transcription/stream-translate', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { enabled?: boolean; language?: string };
    const trans = db.prepare('SELECT id FROM transcriptions WHERE media_file_id = ?').get(id) as { id: number } | undefined;
    if (!trans) {
      return reply.code(404).send({ error: 'Transcription not found' });
    }
    const enabled = Boolean(body?.enabled);
    const lang = body?.language != null && String(body.language).trim() !== '' ? String(body.language).trim() : undefined;
    const updateSql = `
      UPDATE transcriptions
      SET stream_translate_enabled = ?,
          stream_translate_status = ?,
          stream_translate_language = COALESCE(?, stream_translate_language),
          stream_translate_updated_at = datetime('now'),
          stream_translate_error = NULL
      WHERE id = ?
    `;
    db.prepare(updateSql).run(enabled ? 1 : 0, enabled ? 'idle' : 'paused', lang ?? null, trans.id);
    const updated = db.prepare(
      `SELECT stream_translate_enabled, stream_translate_status, stream_translate_language, stream_translate_updated_at
       FROM transcriptions WHERE id = ?`
    ).get(trans.id) as any;
    return {
      status: 'success',
      stream_translate_enabled: Boolean(updated?.stream_translate_enabled),
      stream_translate_status: updated?.stream_translate_status,
      stream_translate_language: updated?.stream_translate_language,
      stream_translate_updated_at: updated?.stream_translate_updated_at,
    };
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
    const { format = 'txt', language = 'en' } = request.query as { format?: string; language?: string };

    const allowedFormats = ['txt', 'json', 'srt', 'vtt', 'srt_translated', 'srt_bilingual'];
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
      const srt = buildSrt(segments as any[], text, file.duration);
      reply.header('Content-Type', 'application/x-subrip; charset=utf-8');
      reply.header('Content-Disposition', buildContentDisposition(safeBaseName, 'srt', fallbackName));
      return srt;
    }

    if (format === 'vtt') {
      const vtt = buildVtt(segments as any[], text, file.duration);
      reply.header('Content-Type', 'text/vtt; charset=utf-8');
      reply.header('Content-Disposition', buildContentDisposition(safeBaseName, 'vtt', fallbackName));
      return vtt;
    }

    if (format === 'srt_translated' || format === 'srt_bilingual') {
      const transRow = db.prepare('SELECT id FROM transcriptions WHERE media_file_id = ?').get(id) as { id: number } | undefined;
      if (!transRow) {
        return reply.code(404).send({ error: 'Transcription not found' });
      }
      const translation = db.prepare(
        'SELECT content FROM translations WHERE transcription_id = ? AND language = ?'
      ).get(transRow.id, language) as { content: string } | undefined;
      if (!translation) {
        return reply.code(404).send({ error: 'Translation not found for this language' });
      }
      let translatedSegments: any[] = [];
      try {
        const parsed = typeof translation.content === 'string' ? JSON.parse(translation.content) : translation.content;
        translatedSegments = Array.isArray(parsed?.segments) ? parsed.segments : Array.isArray(parsed) ? parsed : [];
      } catch {
        translatedSegments = [];
      }

      const mergedSegments = (segments as any[]).map((seg: any, index: number) => {
        const translated = translatedSegments[index]?.text ?? '';
        const textOut = format === 'srt_bilingual'
          ? `${seg.text || ''}\n${translated || ''}`.trim()
          : (translated || '').trim();
        return { start: seg.start, end: seg.end, text: textOut || seg.text || '' };
      });

      const srt = buildSrt(mergedSegments, text, file.duration);
      const suffix = format === 'srt_bilingual' ? 'bilingual' : 'translated';
      const baseNameWithSuffix = `${safeBaseName}.${suffix}`;
      reply.header('Content-Type', 'application/x-subrip; charset=utf-8');
      reply.header('Content-Disposition', buildContentDisposition(baseNameWithSuffix, 'srt', fallbackName));
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

    // 2. 取消任务（若正在转写/排队）
    try {
      queue.cancelByProjectId(id);
    } catch (e) {
      request.log.warn({ projectId: id, err: e }, 'Failed to cancel queue task');
    }

    // 3. 数据库删除
    // 使用事务确保原子性（先删 translations 再删 transcriptions，因 FK 关联）
    const deleteTransaction = db.transaction(() => {
      db.prepare('DELETE FROM translations WHERE transcription_id IN (SELECT id FROM transcriptions WHERE media_file_id = ?)').run(id);
      db.prepare('DELETE FROM translation_segments WHERE transcription_id IN (SELECT id FROM transcriptions WHERE media_file_id = ?)').run(id);
      db.prepare('DELETE FROM transcription_segments WHERE transcription_id IN (SELECT id FROM transcriptions WHERE media_file_id = ?)').run(id);
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

    // 4. 物理文件删除 (不阻塞响应)
    // 本地路径项目不删除用户文件，仅删除项目目录内衍生文件
    try {
      const isProjectPath = ProjectPathService.isProjectPath(file.filepath);
      if (isProjectPath) {
        const basePath = ProjectPathService.parseBasePathFromPath(file.filepath);
        if (basePath) {
          const projectDir = ProjectPathService.getProjectDir(basePath, id);
          if (fs.existsSync(projectDir)) {
            await fs.promises.rm(projectDir, { recursive: true, force: true });
            request.log.info({ projectId: id, projectDir }, 'Project directory deleted');
          }
        }
      } else {
        const storagePaths = StorageService.getAllPaths().map(p => p.path);
        const candidateBasePaths = new Set<string>([...storagePaths, DEFAULT_UPLOAD_DIR]);
        for (const basePath of candidateBasePaths) {
          const projectDir = ProjectPathService.getProjectDir(basePath, id);
          if (fs.existsSync(projectDir)) {
            await fs.promises.rm(projectDir, { recursive: true, force: true });
            request.log.info({ projectId: id, projectDir }, 'Project directory deleted (local path)');
          }
        }
        if (file.audio_path && fs.existsSync(file.audio_path)) {
          await fs.promises.unlink(file.audio_path);
        }
      }
    } catch (e) {
      request.log.error({ projectId: id, err: e }, 'Failed to delete files');
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

    // 重置状态（先提取音频）
    const updateStmt = db.prepare(`
      UPDATE media_files
      SET status = 'waiting_extract', error_message = NULL, failed_stage = NULL
      WHERE id = ?
    `);
    updateStmt.run(id);

    // 清理旧的转写和总结，防止数据冲突
    db.prepare('DELETE FROM translation_segments WHERE transcription_id IN (SELECT id FROM transcriptions WHERE media_file_id = ?)').run(id);
    db.prepare('DELETE FROM transcription_segments WHERE transcription_id IN (SELECT id FROM transcriptions WHERE media_file_id = ?)').run(id);
    db.prepare('DELETE FROM transcriptions WHERE media_file_id = ?').run(id);
    db.prepare('DELETE FROM summaries WHERE media_file_id = ?').run(id);

    // 重新加入队列（先提取音频）
    queue.add('extract', { id: file.id, filepath: file.filepath });

    return { status: 'success', message: 'Audio extraction queued' };
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
  logger.info('Checking dependencies...');
  const checkResults = await DependencyChecker.checkAll();
  DependencyChecker.printResults(checkResults);

  // 如果有致命错误，可以选择退出或继续启动
  if (DependencyChecker.hasCriticalErrors(checkResults)) {
    logger.warn('Critical dependencies are missing. Service will start but may not work properly.');
    logger.warn('Press Ctrl+C to exit, or wait 5 seconds to continue anyway...');

    // 等待 5 秒，给用户时间取消
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  const fastify = buildApp();
  try {
    // 启动日志清理任务（每天清理一次，保留7天）
    startLogCleanupScheduler(7, 24);
    logger.info('Log cleanup scheduler started (cleanup every 24 hours, keep 7 days)');

    startStreamTranslationScheduler(3000);
    logger.info('Stream translation scheduler started (tick every 3 seconds)');

    await fastify.listen({ port: BACKEND_PORT, host: '0.0.0.0' });
    logger.info({ port: BACKEND_PORT }, 'Server listening');
    logger.info({ port: BACKEND_PORT }, 'Backend port is configured via BACKEND_PORT environment variable');
  } catch (err) {
    logger.error({ err }, 'Failed to start server');
    process.exit(1);
  }
};

if (require.main === module) {
  start();
}
