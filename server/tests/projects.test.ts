import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { buildApp } from '../src/app';
import db from '../src/db';

describe('Projects API', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // 每个测试前清空数据库，确保环境独立
    db.prepare('DELETE FROM media_files').run();
  });

  it('GET /api/projects should return empty list initially', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/projects'
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual([]);
  });

  it('should handle project lifecycle (create via DB, get, delete)', async () => {
    // 1. 直接向数据库插入模拟数据 (Mock Data)
    const stmt = db.prepare(`
      INSERT INTO media_files (filename, filepath, original_name, mime_type, status)
      VALUES (?, ?, ?, ?, ?)
    `);
    // 使用虚拟路径
    const info = stmt.run('test-file.mp3', '/tmp/test-file.mp3', 'test.mp3', 'audio/mpeg', 'pending');
    const id = info.lastInsertRowid;

    // 2. 获取列表 (Get List)
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/projects'
    });
    expect(listRes.statusCode).toBe(200);
    const listData = listRes.json().data;
    expect(listData).toHaveLength(1);
    expect(listData[0].id).toBe(id);
    expect(listData[0].original_name).toBe('test.mp3');

    // 3. 获取详情 (Get Detail)
    const detailRes = await app.inject({
      method: 'GET',
      url: `/api/projects/${id}`
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().original_name).toBe('test.mp3');
    expect(detailRes.json().status).toBe('pending');

    // 4. 删除项目 (Delete)
    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/projects/${id}`
    });
    expect(deleteRes.statusCode).toBe(200);

    // 5. 验证删除 (Verify Deletion)
    const verifyRes = await app.inject({
      method: 'GET',
      url: `/api/projects/${id}`
    });
    expect(verifyRes.statusCode).toBe(404);

    // 验证数据库为空
    const checkDb = db.prepare('SELECT count(*) as count FROM media_files').get() as { count: number };
    expect(checkDb.count).toBe(0);
  });
});

