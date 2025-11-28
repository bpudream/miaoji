import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import db from '../db';

export interface StoragePath {
  id: number;
  name: string;
  path: string;
  enabled: boolean;
  priority: number;
  max_size_gb: number | null;
  created_at: string;
  updated_at: string;
}

export interface StorageInfo {
  total: number;      // 总容量（字节）
  used: number;       // 已用空间（字节）
  free: number;       // 可用空间（字节）
  usagePercent: number; // 使用百分比
}

export interface StoragePathWithInfo extends StoragePath {
  info?: StorageInfo;
}

export class StorageService {
  /**
   * 获取磁盘信息（跨平台）
   */
  static getDiskInfo(dirPath: string): StorageInfo | null {
    try {
      // 确保路径存在
      if (!fs.existsSync(dirPath)) {
        return null;
      }

      // Windows 系统
      if (process.platform === 'win32') {
        try {
          // 获取盘符（例如 C:\）
          const drive = path.parse(dirPath).root;
          // 使用 wmic 命令获取磁盘信息
          const command = `wmic logicaldisk where "DeviceID='${drive.replace('\\', '')}'" get Size,FreeSpace /format:value`;
          const output = execSync(command, { encoding: 'utf-8' });

          let size = 0;
          let freeSpace = 0;

          for (const line of output.split('\n')) {
            if (line.startsWith('Size=')) {
              size = parseInt(line.split('=')[1].trim(), 10);
            } else if (line.startsWith('FreeSpace=')) {
              freeSpace = parseInt(line.split('=')[1].trim(), 10);
            }
          }

          if (size > 0) {
            const used = size - freeSpace;
            return {
              total: size,
              used: used,
              free: freeSpace,
              usagePercent: (used / size) * 100
            };
          }
        } catch (e) {
          console.error(`[Storage] Error getting disk info on Windows: ${e}`);
        }
      } else {
        // Linux/Mac 系统
        try {
          const output = execSync(`df -k "${dirPath}"`, { encoding: 'utf-8' });
          const lines = output.trim().split('\n');
          if (lines.length >= 2) {
            const parts = lines[1].split(/\s+/);
            if (parts.length >= 4) {
              const total = parseInt(parts[1], 10) * 1024; // 转换为字节
              const used = parseInt(parts[2], 10) * 1024;
              const free = parseInt(parts[3], 10) * 1024;
              return {
                total,
                used,
                free,
                usagePercent: (used / total) * 100
              };
            }
          }
        } catch (e) {
          console.error(`[Storage] Error getting disk info on Unix: ${e}`);
        }
      }

      // Fallback: 如果无法获取磁盘信息，返回 null
      // 在实际使用中，可以尝试其他方法或使用第三方库

      return null;
    } catch (error) {
      console.error(`[Storage] Error getting disk info for ${dirPath}:`, error);
      return null;
    }
  }

  /**
   * 获取所有存储路径
   */
  static getAllPaths(): StoragePath[] {
    const stmt = db.prepare('SELECT * FROM storage_paths ORDER BY priority DESC, id ASC');
    return stmt.all() as StoragePath[];
  }

  /**
   * 获取所有启用的存储路径及其磁盘信息
   */
  static async getAllPathsWithInfo(): Promise<StoragePathWithInfo[]> {
    const paths = this.getAllPaths().filter(p => p.enabled);
    const result: StoragePathWithInfo[] = [];

    for (const path of paths) {
      const info = this.getDiskInfo(path.path);
      result.push({
        ...path,
        info: info || undefined
      });
    }

    return result;
  }

  /**
   * 获取最佳存储路径（可用空间最大的）
   */
  static getBestStoragePath(): string {
    const paths = this.getAllPaths().filter(p => p.enabled);

    if (paths.length === 0) {
      // 如果没有配置路径，使用默认路径
      const defaultPath = path.join(__dirname, '../../uploads');
      console.warn(`[Storage] No storage paths configured, using default: ${defaultPath}`);
      return defaultPath;
    }

    let bestPath: StoragePath | null = null;
    let maxFreeSpace = -1;

    for (const storagePath of paths) {
      const info = this.getDiskInfo(storagePath.path);

      if (!info) {
        console.warn(`[Storage] Cannot get disk info for ${storagePath.path}, skipping`);
        continue;
      }

      // 检查最大容量限制
      if (storagePath.max_size_gb !== null) {
        const maxBytes = storagePath.max_size_gb * 1024 * 1024 * 1024;
        if (info.used >= maxBytes) {
          console.warn(`[Storage] Path ${storagePath.path} exceeds max size limit, skipping`);
          continue;
        }
        // 可用空间 = min(实际可用空间, 限制内的剩余空间)
        const availableInLimit = maxBytes - info.used;
        if (availableInLimit <= 0) {
          continue;
        }
      }

      // 选择可用空间最大的路径
      if (info.free > maxFreeSpace) {
        maxFreeSpace = info.free;
        bestPath = storagePath;
      }
    }

    if (!bestPath) {
      // 如果所有路径都不可用，使用第一个启用的路径（至少尝试）
      const firstEnabled = paths[0];
      if (firstEnabled) {
        console.warn(`[Storage] No suitable path found, using first enabled: ${firstEnabled.path}`);
        return firstEnabled.path;
      }
      // 最后的 fallback
      const defaultPath = path.join(__dirname, '../../uploads');
      console.warn(`[Storage] No storage paths available, using default: ${defaultPath}`);
      return defaultPath;
    }

    console.log(`[Storage] Selected best path: ${bestPath.path} (${(maxFreeSpace / 1024 / 1024 / 1024).toFixed(2)} GB free)`);
    return bestPath.path;
  }

  /**
   * 验证路径是否有效（存在且可写）
   */
  static validatePath(dirPath: string): { valid: boolean; error?: string } {
    try {
      // 检查是否为绝对路径
      if (!path.isAbsolute(dirPath)) {
        return { valid: false, error: '路径必须是绝对路径' };
      }

      // 检查路径是否存在
      if (!fs.existsSync(dirPath)) {
        return { valid: false, error: '路径不存在' };
      }

      // 检查是否为目录
      const stats = fs.statSync(dirPath);
      if (!stats.isDirectory()) {
        return { valid: false, error: '路径不是目录' };
      }

      // 检查是否可写（尝试创建测试文件）
      const testFile = path.join(dirPath, `.test_write_${Date.now()}`);
      try {
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
      } catch (e) {
        return { valid: false, error: '目录不可写' };
      }

      return { valid: true };
    } catch (error: any) {
      return { valid: false, error: error.message || '路径验证失败' };
    }
  }

  /**
   * 添加存储路径
   */
  static addPath(name: string, dirPath: string, priority: number = 0, maxSizeGb: number | null = null): number {
    const validation = this.validatePath(dirPath);
    if (!validation.valid) {
      throw new Error(validation.error || '路径验证失败');
    }

    // 检查路径是否已存在
    const existing = db.prepare('SELECT id FROM storage_paths WHERE path = ?').get(dirPath) as { id: number } | undefined;
    if (existing) {
      throw new Error('该路径已存在');
    }

    const stmt = db.prepare(`
      INSERT INTO storage_paths (name, path, enabled, priority, max_size_gb)
      VALUES (?, ?, 1, ?, ?)
    `);
    const result = stmt.run(name, dirPath, priority, maxSizeGb);
    return Number(result.lastInsertRowid);
  }

  /**
   * 更新存储路径
   */
  static updatePath(id: number, updates: { name?: string; enabled?: boolean; priority?: number; max_size_gb?: number | null }): void {
    const updatesList: string[] = [];
    const params: any[] = [];

    if (updates.name !== undefined) {
      updatesList.push('name = ?');
      params.push(updates.name);
    }
    if (updates.enabled !== undefined) {
      updatesList.push('enabled = ?');
      params.push(updates.enabled ? 1 : 0);
    }
    if (updates.priority !== undefined) {
      updatesList.push('priority = ?');
      params.push(updates.priority);
    }
    if (updates.max_size_gb !== undefined) {
      updatesList.push('max_size_gb = ?');
      params.push(updates.max_size_gb);
    }

    if (updatesList.length === 0) {
      return;
    }

    updatesList.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    const sql = `UPDATE storage_paths SET ${updatesList.join(', ')} WHERE id = ?`;
    db.prepare(sql).run(...params);
  }

  /**
   * 删除存储路径
   */
  static deletePath(id: number): void {
    // 检查是否有文件使用该路径
    const pathRecord = db.prepare('SELECT path FROM storage_paths WHERE id = ?').get(id) as { path: string } | undefined;
    if (!pathRecord) {
      throw new Error('存储路径不存在');
    }

    // 检查是否有文件在该路径下
    const files = db.prepare('SELECT COUNT(*) as count FROM media_files WHERE filepath LIKE ?').get(`${pathRecord.path}%`) as { count: number };
    if (files.count > 0) {
      throw new Error(`该路径下还有 ${files.count} 个文件，请先迁移文件后再删除`);
    }

    db.prepare('DELETE FROM storage_paths WHERE id = ?').run(id);
  }

  /**
   * 获取指定路径的磁盘信息
   */
  static getPathInfo(pathId: number): StoragePathWithInfo | null {
    const pathRecord = db.prepare('SELECT * FROM storage_paths WHERE id = ?').get(pathId) as StoragePath | undefined;
    if (!pathRecord) {
      return null;
    }

    const info = this.getDiskInfo(pathRecord.path);
    return {
      ...pathRecord,
      info: info || undefined
    };
  }

  /**
   * 迁移单个文件到新路径
   */
  static async migrateFile(
    fileId: number,
    targetPathId: number,
    options: { deleteSource?: boolean } = {}
  ): Promise<{ success: boolean; message: string; newPath?: string }> {
    // 获取文件信息
    const file = db.prepare('SELECT filepath, audio_path FROM media_files WHERE id = ?').get(fileId) as {
      filepath: string;
      audio_path: string | null;
    } | undefined;

    if (!file) {
      throw new Error('文件不存在');
    }

    // 获取目标路径
    const targetPath = db.prepare('SELECT path FROM storage_paths WHERE id = ?').get(targetPathId) as {
      path: string;
    } | undefined;

    if (!targetPath) {
      throw new Error('目标存储路径不存在');
    }

    // 验证目标路径
    const validation = this.validatePath(targetPath.path);
    if (!validation.valid) {
      throw new Error(validation.error || '目标路径无效');
    }

    // 检查目标路径磁盘空间
    const targetInfo = this.getDiskInfo(targetPath.path);
    if (targetInfo) {
      const fileSize = fs.existsSync(file.filepath) ? fs.statSync(file.filepath).size : 0;
      const audioSize = file.audio_path && fs.existsSync(file.audio_path) ? fs.statSync(file.audio_path).size : 0;
      const totalSize = fileSize + audioSize;

      if (targetInfo.free < totalSize) {
        throw new Error(`目标路径磁盘空间不足（需要 ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB，可用 ${(targetInfo.free / 1024 / 1024 / 1024).toFixed(2)} GB）`);
      }
    }

    try {
      // 复制主文件
      const sourceFileName = path.basename(file.filepath);
      const newFilePath = path.join(targetPath.path, sourceFileName);

      // 如果目标文件已存在，添加时间戳后缀
      let finalNewPath = newFilePath;
      if (fs.existsSync(finalNewPath)) {
        const ext = path.extname(sourceFileName);
        const name = path.basename(sourceFileName, ext);
        finalNewPath = path.join(targetPath.path, `${name}_${Date.now()}${ext}`);
      }

      if (fs.existsSync(file.filepath)) {
        fs.copyFileSync(file.filepath, finalNewPath);
      } else {
        throw new Error('源文件不存在');
      }

      // 复制音频文件（如果存在）
      let newAudioPath: string | null = null;
      if (file.audio_path && fs.existsSync(file.audio_path)) {
        const audioFileName = path.basename(file.audio_path);
        newAudioPath = path.join(targetPath.path, audioFileName);

        // 如果目标文件已存在，添加时间戳后缀
        if (fs.existsSync(newAudioPath)) {
          const ext = path.extname(audioFileName);
          const name = path.basename(audioFileName, ext);
          newAudioPath = path.join(targetPath.path, `${name}_${Date.now()}${ext}`);
        }

        fs.copyFileSync(file.audio_path, newAudioPath);
      }

      // 更新数据库
      db.prepare('UPDATE media_files SET filepath = ?, audio_path = ? WHERE id = ?').run(
        finalNewPath,
        newAudioPath,
        fileId
      );

      // 删除源文件（如果选项启用）
      if (options.deleteSource) {
        try {
          if (fs.existsSync(file.filepath)) {
            fs.unlinkSync(file.filepath);
          }
          if (file.audio_path && fs.existsSync(file.audio_path)) {
            fs.unlinkSync(file.audio_path);
          }
        } catch (e) {
          console.warn(`[Storage] Failed to delete source files: ${e}`);
          // 不抛出错误，因为迁移已经成功
        }
      }

      return {
        success: true,
        message: '文件迁移成功',
        newPath: finalNewPath
      };
    } catch (error: any) {
      throw new Error(`文件迁移失败: ${error.message}`);
    }
  }

  /**
   * 批量迁移文件
   */
  static async migrateFiles(
    fileIds: number[],
    targetPathId: number,
    options: {
      deleteSource?: boolean;
      onProgress?: (current: number, total: number, fileId: number, success: boolean, message: string) => void;
    } = {}
  ): Promise<{
    total: number;
    success: number;
    failed: number;
    results: Array<{ fileId: number; success: boolean; message: string }>;
  }> {
    const results: Array<{ fileId: number; success: boolean; message: string }> = [];
    let successCount = 0;
    let failedCount = 0;

    for (let i = 0; i < fileIds.length; i++) {
      const fileId = fileIds[i];
      let result: { fileId: number; success: boolean; message: string };

      try {
        const migrateResult = await this.migrateFile(fileId, targetPathId, {
          deleteSource: options.deleteSource
        });
        result = {
          fileId,
          success: true,
          message: migrateResult.message
        };
        successCount++;
      } catch (error: any) {
        result = {
          fileId,
          success: false,
          message: error.message || '迁移失败'
        };
        failedCount++;
      }

      results.push(result);

      // 调用进度回调
      if (options.onProgress) {
        options.onProgress(i + 1, fileIds.length, fileId, result.success, result.message);
      }
    }

    return {
      total: fileIds.length,
      success: successCount,
      failed: failedCount,
      results
    };
  }
}

