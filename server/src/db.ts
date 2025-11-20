import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

// 确保数据目录存在
const DB_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const dbPath = path.join(DB_DIR, 'miaoji.db');
const db = new Database(dbPath); // 暂时去掉 verbose 避免日志太乱

// 初始化表结构
const initDb = () => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS media_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      original_name TEXT,
      size INTEGER,
      mime_type TEXT,
      status TEXT DEFAULT 'pending', -- pending, processing, completed, error
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (media_file_id) REFERENCES media_files(id)
    );
  `);
};

initDb();

export default db;

