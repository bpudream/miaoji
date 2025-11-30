import pino from 'pino';
import path from 'node:path';
import fs from 'node:fs';
import { getServerRoot } from './paths';

/**
 * 创建日志目录
 */
const ensureLogDir = () => {
  const logDir = path.join(getServerRoot(), 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  return logDir;
};

/**
 * 获取日志级别
 * 从环境变量 LOG_LEVEL 读取，默认为 'info'
 * 生产环境：error, warn, info
 * 开发环境：error, warn, info, debug
 */
const getLogLevel = (): string => {
  const envLevel = process.env.LOG_LEVEL;
  if (envLevel) {
    return envLevel;
  }
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
};

/**
 * 创建 Pino 日志配置
 * 用于 Fastify 的 logger 配置
 */
export const createLoggerConfig = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const logDir = ensureLogDir();
  const logLevel = getLogLevel();

  // 日志文件路径（使用日期作为文件名，实现按日轮转）
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const logFile = path.join(logDir, `app-${today}.log`);
  const errorLogFile = path.join(logDir, `error-${today}.log`);

  // 开发环境：使用 pino-pretty 美化输出
  if (!isProduction) {
    try {
      require.resolve('pino-pretty');
      return {
        level: logLevel,
        transport: {
          targets: [
            // 控制台输出（美化）
            {
              target: 'pino-pretty',
              level: logLevel,
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
                colorize: true,
                singleLine: false,
              },
            },
            // 文件输出（JSON格式）
            {
              target: 'pino/file',
              level: logLevel,
              options: {
                destination: logFile,
                mkdir: true,
              },
            },
            // 错误日志单独文件
            {
              target: 'pino/file',
              level: 'error',
              options: {
                destination: errorLogFile,
                mkdir: true,
              },
            },
          ],
        },
      };
    } catch (e) {
      // pino-pretty 未安装，使用默认配置
      console.warn('[Logger] pino-pretty not found, using default JSON logger');
    }
  }

  // 生产环境：JSON格式输出到文件和控制台
  return {
    level: logLevel,
    transport: {
      targets: [
        // 控制台输出（JSON格式）
        {
          target: 'pino/file',
          level: logLevel,
          options: {
            destination: 1, // stdout
          },
        },
        // 应用日志文件（按日期）
        {
          target: 'pino/file',
          level: logLevel,
          options: {
            destination: logFile,
            mkdir: true,
          },
        },
        // 错误日志单独文件（按日期）
        {
          target: 'pino/file',
          level: 'error',
          options: {
            destination: errorLogFile,
            mkdir: true,
          },
        },
      ],
    },
  };
};

/**
 * 创建独立的日志实例（用于非 Fastify 场景）
 */
export const createStandaloneLogger = () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const logDir = ensureLogDir();
  const logLevel = getLogLevel();
  const today = new Date().toISOString().split('T')[0];
  const logFile = path.join(logDir, `app-${today}.log`);
  const errorLogFile = path.join(logDir, `error-${today}.log`);

  // 注意：使用 transport.targets 时不能使用自定义 formatters.level
  // 所以这里只设置基本的配置
  const baseConfig: pino.LoggerOptions = {
    level: logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    // 移除 formatters.level，因为 transport.targets 不支持
  };

  if (!isProduction) {
    try {
      require.resolve('pino-pretty');
      return pino({
        level: logLevel,
        timestamp: pino.stdTimeFunctions.isoTime,
        transport: {
          targets: [
            {
              target: 'pino-pretty',
              level: logLevel,
              options: {
                translateTime: 'HH:MM:ss Z',
                ignore: 'pid,hostname',
                colorize: true,
              },
            },
            {
              target: 'pino/file',
              level: logLevel,
              options: { destination: logFile, mkdir: true },
            },
            {
              target: 'pino/file',
              level: 'error',
              options: { destination: errorLogFile, mkdir: true },
            },
          ],
        },
      });
    } catch (e) {
      // fallback
    }
  }

  return pino({
    level: logLevel,
    timestamp: pino.stdTimeFunctions.isoTime,
    transport: {
      targets: [
        {
          target: 'pino/file',
          level: logLevel,
          options: { destination: 1 }, // stdout
        },
        {
          target: 'pino/file',
          level: logLevel,
          options: { destination: logFile, mkdir: true },
        },
        {
          target: 'pino/file',
          level: 'error',
          options: { destination: errorLogFile, mkdir: true },
        },
      ],
    },
  });
};

/**
 * 独立的日志实例（用于非 Fastify 场景）
 */
export const logger = createStandaloneLogger();

/**
 * 创建带请求ID的日志上下文
 */
export const createRequestLogger = (requestId: string, baseLogger: pino.Logger = logger) => {
  return baseLogger.child({ requestId });
};

