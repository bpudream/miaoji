import path from 'node:path';
import fs from 'node:fs';

/**
 * 项目路径管理服务
 * 统一管理所有项目相关的文件路径构建逻辑
 */
export class ProjectPathService {
  /**
   * 获取项目目录路径
   * @param basePath 存储基础路径（storage_path）
   * @param projectId 项目ID（UUID字符串或数字，兼容旧数据）
   * @returns 项目目录路径，格式：{basePath}/{projectId}/
   */
  static getProjectDir(basePath: string, projectId: string | number): string {
    return path.join(basePath, String(projectId));
  }

  /**
   * 确保项目目录存在，如果不存在则创建
   * @param basePath 存储基础路径
   * @param projectId 项目ID（UUID字符串或数字，兼容旧数据）
   * @returns 项目目录路径
   */
  static ensureProjectDir(basePath: string, projectId: string | number): string {
    const projectDir = this.getProjectDir(basePath, projectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    return projectDir;
  }

  /**
   * 获取原始文件路径
   * @param basePath 存储基础路径
   * @param projectId 项目ID（UUID字符串或数字，兼容旧数据）
   * @param ext 文件扩展名（包含点号，如 .mp4, .mp3）
   * @returns 原始文件完整路径，格式：{basePath}/{projectId}/original{ext}
   */
  static getOriginalFilePath(basePath: string, projectId: string | number, ext: string): string {
    const projectDir = this.getProjectDir(basePath, projectId);
    return path.join(projectDir, `original${ext}`);
  }

  /**
   * 获取音频文件路径
   * @param basePath 存储基础路径
   * @param projectId 项目ID（UUID字符串或数字，兼容旧数据）
   * @returns 音频文件完整路径，格式：{basePath}/{projectId}/audio.wav
   */
  static getAudioFilePath(basePath: string, projectId: string | number): string {
    const projectDir = this.getProjectDir(basePath, projectId);
    return path.join(projectDir, 'audio.wav');
  }

  /**
   * 从文件路径解析项目ID
   * 假设路径格式为：{basePath}/{projectId}/original.{ext} 或 {basePath}/{projectId}/audio.wav
   * @param filePath 文件完整路径
   * @returns 项目ID（UUID字符串或数字），如果无法解析则返回 null
   */
  static parseProjectIdFromPath(filePath: string): string | number | null {
    try {
      const dir = path.dirname(filePath);
      const dirName = path.basename(dir);

      // 先尝试作为UUID（36个字符，包含连字符）
      if (dirName.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dirName)) {
        return dirName;
      }

      // 再尝试作为数字（兼容旧数据）
      const projectId = parseInt(dirName, 10);
      if (!isNaN(projectId) && projectId > 0) {
        return projectId;
      }
    } catch (e) {
      // 忽略解析错误
    }
    return null;
  }

  /**
   * 从文件路径解析存储基础路径
   * 假设路径格式为：{basePath}/{projectId}/original.{ext}
   * @param filePath 文件完整路径
   * @returns 存储基础路径，如果无法解析则返回 null
   */
  static parseBasePathFromPath(filePath: string): string | null {
    try {
      const dir = path.dirname(filePath);
      const parentDir = path.dirname(dir);
      // 验证父目录是否存在（确保路径有效）
      if (fs.existsSync(parentDir)) {
        return parentDir;
      }
    } catch (e) {
      // 忽略解析错误
    }
    return null;
  }

  /**
   * 从文件路径解析项目ID和基础路径
   * @param filePath 文件完整路径
   * @returns { projectId: string | number | null, basePath: string | null }
   */
  static parsePathInfo(filePath: string): { projectId: string | number | null; basePath: string | null } {
    const projectId = this.parseProjectIdFromPath(filePath);
    const basePath = this.parseBasePathFromPath(filePath);
    return { projectId, basePath };
  }

  /**
   * 检查文件路径是否符合项目目录结构
   * @param filePath 文件路径
   * @returns 是否符合项目目录结构
   */
  static isProjectPath(filePath: string): boolean {
    const fileName = path.basename(filePath);
    const dir = path.dirname(filePath);
    const dirName = path.basename(dir);

    // 检查目录名是否为UUID或数字（项目ID）
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dirName);
    const isNumeric = !isNaN(parseInt(dirName, 10)) && parseInt(dirName, 10) > 0;

    if (!isUuid && !isNumeric) {
      return false;
    }

    // 检查文件名是否为 original.{ext} 或 audio.wav
    return fileName === 'audio.wav' || fileName.startsWith('original.');
  }
}

