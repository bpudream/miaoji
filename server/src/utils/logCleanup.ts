import fs from 'node:fs';
import path from 'node:path';
import { getServerRoot } from './paths';
import { logger } from './logger';

/**
 * 清理旧的日志文件
 * @param daysToKeep 保留最近几天的日志（默认7天）
 */
export function cleanupOldLogs(daysToKeep: number = 7): void {
  const logDir = path.join(getServerRoot(), 'logs');

  if (!fs.existsSync(logDir)) {
    return;
  }

  const files = fs.readdirSync(logDir);
  const now = Date.now();
  const maxAge = daysToKeep * 24 * 60 * 60 * 1000; // 转换为毫秒
  let deletedCount = 0;

  for (const file of files) {
    const filePath = path.join(logDir, file);
    try {
      const stats = fs.statSync(filePath);
      const age = now - stats.mtime.getTime();

      if (age > maxAge) {
        fs.unlinkSync(filePath);
        deletedCount++;
        logger.debug({ file, age: `${Math.floor(age / (24 * 60 * 60 * 1000))} days` }, 'Deleted old log file');
      }
    } catch (err) {
      logger.warn({ file, err }, 'Failed to process log file');
    }
  }

  if (deletedCount > 0) {
    logger.info({ deletedCount, daysToKeep }, 'Log cleanup completed');
  }
}

/**
 * 启动定期日志清理任务
 * @param daysToKeep 保留最近几天的日志（默认7天）
 * @param intervalHours 清理间隔（小时，默认24小时）
 */
export function startLogCleanupScheduler(daysToKeep: number = 7, intervalHours: number = 24): NodeJS.Timeout {
  // 立即执行一次
  cleanupOldLogs(daysToKeep);

  // 设置定时任务
  const interval = intervalHours * 60 * 60 * 1000;
  return setInterval(() => {
    cleanupOldLogs(daysToKeep);
  }, interval);
}

