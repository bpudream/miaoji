import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

// 确保数据目录存在
const DB_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const isTest = process.env.NODE_ENV === 'test';
const dbPath = isTest ? ':memory:' : path.join(DB_DIR, 'miaoji.db');
const db = new Database(dbPath); // 暂时去掉 verbose 避免日志太乱

// 初始化表结构
const initDb = () => {
  // 如果是测试环境，每次都重建表
  if (isTest) {
    db.exec('DROP TABLE IF EXISTS summaries');
    db.exec('DROP TABLE IF EXISTS transcriptions');
    db.exec('DROP TABLE IF EXISTS media_files');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS media_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      audio_path TEXT,            -- 提取后的音频路径 (16kHz WAV)
      original_name TEXT,
      size INTEGER,
      mime_type TEXT,
      status TEXT DEFAULT 'pending', -- pending, extracting, ready_to_transcribe, transcribing, transcribed, completed, error
      error_message TEXT,         -- 错误信息
      failed_stage TEXT,          -- 失败阶段
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 简单的迁移逻辑：尝试添加新列（如果旧数据库存在）
  // 注意：在生产环境中应使用专门的迁移工具
  const columns = [
    'audio_path TEXT',
    'error_message TEXT',
    'failed_stage TEXT',
    'duration REAL' // 添加 duration 字段
  ];

  if (!isTest) {
    columns.forEach(col => {
      try {
        const colName = col.split(' ')[0];
        db.exec(`ALTER TABLE media_files ADD COLUMN ${col}`);
        console.log(`[DB] Added column ${colName} to media_files`);
      } catch (e: any) {
        // 忽略 "duplicate column name" 错误
        if (!e.message.includes('duplicate column name')) {
          // console.error(`[DB] Migration error: ${e.message}`);
        }
      }
    });
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS transcriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_file_id INTEGER,
      content TEXT,
      format TEXT DEFAULT 'text',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (media_file_id) REFERENCES media_files(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_file_id INTEGER,
      content TEXT,
      model TEXT,
      mode TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (media_file_id) REFERENCES media_files(id)
    );
  `);

  // 配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 存储路径配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS storage_paths (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      enabled BOOLEAN DEFAULT 1,
      priority INTEGER DEFAULT 0,
      max_size_gb INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 为 storage_paths 表创建索引
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_storage_paths_enabled ON storage_paths(enabled)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_storage_paths_priority ON storage_paths(priority DESC)');
  } catch (e: any) {
    // 忽略索引已存在的错误
  }

  // 初始化默认配置（仅后端端口，前端端口由前端自己管理）
  if (!isTest) {
    try {
      const defaultBackendPort = db.prepare('SELECT value FROM settings WHERE key = ?').get('backend_port');
      if (!defaultBackendPort) {
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('backend_port', '3000');
      }

      // 初始化默认存储路径（如果表为空）
      const defaultPath = db.prepare('SELECT COUNT(*) as count FROM storage_paths').get() as { count: number };
      if (defaultPath.count === 0) {
        const defaultUploadDir = path.join(__dirname, '../uploads');
        db.prepare(`
          INSERT INTO storage_paths (name, path, enabled, priority)
          VALUES (?, ?, 1, 0)
        `).run('默认路径', defaultUploadDir);
        console.log(`[DB] Initialized default storage path: ${defaultUploadDir}`);
      }
    } catch (e: any) {
      // 忽略错误（表可能已存在）
      console.error('[DB] Error initializing default storage path:', e.message);
    }
  }
};

initDb();

export default db;
