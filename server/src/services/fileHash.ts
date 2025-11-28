import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { Readable } from 'node:stream';

/**
 * 计算文件的MD5哈希值（使用流式读取，适合大文件）
 * @param filePath 文件路径
 * @returns Promise<string> MD5哈希值（十六进制字符串）
 */
export async function calculateFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => {
      hash.update(chunk);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * 从文件流计算MD5哈希值（用于上传时）
 * @param stream 文件流
 * @returns Promise<string> MD5哈希值（十六进制字符串）
 */
export async function calculateStreamHash(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('md5');
    const chunks: Buffer[] = [];

    stream.on('data', (chunk: Buffer) => {
      hash.update(chunk);
      chunks.push(chunk);
    });

    stream.on('end', () => {
      resolve(hash.digest('hex'));
    });

    stream.on('error', (err) => {
      reject(err);
    });
  });
}

