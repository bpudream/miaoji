import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

// 确保数据目录存在
const DB_DIR = path.join(__dirname, '../data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const isTest = process.env.NODE_ENV === 'test';
const dbPath = isTest ? ':memory:' : path.join(DB_DIR, 'miaoji.db');
const db = new Database(dbPath); // 暂时去掉 verbose 避免日志太乱

// UUID迁移函数
const migrateToUuid = () => {
  try {
    // 创建迁移标记表
    db.exec(`
      CREATE TABLE IF NOT EXISTS media_files_uuid_migrated (
        id INTEGER PRIMARY KEY,
        migrated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 检查是否已经迁移过
    const migrated = db.prepare('SELECT * FROM media_files_uuid_migrated LIMIT 1').get();
    if (migrated) {
      console.log('[DB] UUID迁移已完成，跳过');
      return;
    }

    console.log('[DB] 开始UUID迁移...');

    // 1. 创建新表（使用UUID）
    db.exec(`
      CREATE TABLE IF NOT EXISTS media_files_new (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        filepath TEXT NOT NULL,
        audio_path TEXT,
        original_name TEXT,
        display_name TEXT,
        size INTEGER,
        mime_type TEXT,
        status TEXT DEFAULT 'pending',
        error_message TEXT,
        failed_stage TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. 迁移数据：为每个项目生成UUID
    const oldFiles = db.prepare('SELECT * FROM media_files').all() as any[];
    console.log(`[DB] 找到 ${oldFiles.length} 个旧项目，开始迁移...`);

    const insertStmt = db.prepare(`
      INSERT INTO media_files_new (id, filename, filepath, audio_path, original_name, display_name, size, mime_type, status, error_message, failed_stage, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const updateTransStmt = db.prepare('UPDATE transcriptions SET media_file_id = ? WHERE media_file_id = ?');
    const updateSumStmt = db.prepare('UPDATE summaries SET media_file_id = ? WHERE media_file_id = ?');

    for (const oldFile of oldFiles) {
      const newUuid = randomUUID();

      // 插入新表
      insertStmt.run(
        newUuid,
        oldFile.filename,
        oldFile.filepath,
        oldFile.audio_path || null,
        oldFile.original_name || null,
        oldFile.display_name || null,
        oldFile.size || null,
        oldFile.mime_type || null,
        oldFile.status || 'pending',
        oldFile.error_message || null,
        oldFile.failed_stage || null,
        oldFile.created_at || new Date().toISOString()
      );

      // 更新关联表
      updateTransStmt.run(newUuid, oldFile.id);
      updateSumStmt.run(newUuid, oldFile.id);

      // 迁移文件：重命名目录从 INTEGER ID 到 UUID
      if (oldFile.filepath) {
        try {
          const oldProjectDir = path.dirname(oldFile.filepath);
          const basePath = path.dirname(oldProjectDir);
          const oldDirName = path.basename(oldProjectDir);

          // 如果目录名是数字（项目ID），则重命名为UUID
          const oldId = parseInt(oldDirName, 10);
          if (!isNaN(oldId) && oldId === oldFile.id) {
            const newProjectDir = path.join(basePath, newUuid);
            if (fs.existsSync(oldProjectDir) && !fs.existsSync(newProjectDir)) {
              fs.renameSync(oldProjectDir, newProjectDir);
              console.log(`[DB] 重命名项目目录: ${oldId} -> ${newUuid}`);

              // 更新文件路径
              const newFilePath = path.join(newProjectDir, path.basename(oldFile.filepath));
              const newAudioPath = oldFile.audio_path ? path.join(newProjectDir, path.basename(oldFile.audio_path)) : null;

              db.prepare('UPDATE media_files_new SET filepath = ?, audio_path = ? WHERE id = ?').run(
                newFilePath,
                newAudioPath,
                newUuid
              );
            }
          }
        } catch (e: any) {
          console.warn(`[DB] 迁移文件目录失败 (ID ${oldFile.id}):`, e.message);
        }
      }
    }

    // 3. 删除旧表并重命名新表
    db.exec('DROP TABLE IF EXISTS media_files');
    db.exec('ALTER TABLE media_files_new RENAME TO media_files');

    // 4. 标记迁移完成
    db.prepare('INSERT INTO media_files_uuid_migrated (id) VALUES (1)').run();

    console.log(`[DB] UUID迁移完成，共迁移 ${oldFiles.length} 个项目`);
  } catch (e: any) {
    console.error('[DB] UUID迁移失败:', e);
    throw e;
  }
};

// 初始化表结构
const initDb = () => {
  // 如果是测试环境，每次都重建表
  if (isTest) {
    db.exec('DROP TABLE IF EXISTS summaries');
    db.exec('DROP TABLE IF EXISTS transcriptions');
    db.exec('DROP TABLE IF EXISTS transcription_segments');
    db.exec('DROP TABLE IF EXISTS translation_segments');
    db.exec('DROP TABLE IF EXISTS media_files');
    db.exec('DROP TABLE IF EXISTS media_files_uuid_migrated');
    db.exec('DROP TABLE IF EXISTS teams');
  }

  // 检查是否需要迁移到UUID
  const needsUuidMigration = !isTest && !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='media_files_uuid_migrated'").get();

  if (needsUuidMigration) {
    // 检查旧表是否存在且使用INTEGER ID
    const oldTableInfo = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='media_files'").get() as { sql: string } | undefined;
    const hasIntegerId = oldTableInfo && oldTableInfo.sql.includes('id INTEGER PRIMARY KEY AUTOINCREMENT');

    if (hasIntegerId) {
      console.log('[DB] 检测到旧数据库结构（INTEGER ID），开始迁移到UUID...');
      migrateToUuid();
      console.log('[DB] UUID迁移完成');
    }
  }

  const ensureColumn = (table: string, column: string, definition: string) => {
    const columns = db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row: any) => row.name as string);
    if (!columns.includes(column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  };

  db.exec(`
    CREATE TABLE IF NOT EXISTS media_files (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      filepath TEXT NOT NULL,
      audio_path TEXT,            -- 提取后的音频路径 (16kHz WAV)
      original_name TEXT,
      display_name TEXT,         -- 用户自定义的显示名称
      file_hash TEXT,            -- 文件MD5哈希值，用于检测重复文件
      size INTEGER,
      mime_type TEXT,
      scenario TEXT,
      transcribe_meta TEXT,       -- JSON: { team_home_id?, team_away_id?, keywords? }
      status TEXT DEFAULT 'pending', -- pending, waiting_extract, extracting, ready_to_transcribe, transcribing, transcribed, completed, cancelled, error
      error_message TEXT,
      failed_stage TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 为 file_hash 字段添加索引（如果不存在）
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_media_files_file_hash ON media_files(file_hash)');
  } catch (e: any) {
    // 忽略索引已存在的错误
  }

  // 简单的迁移逻辑：尝试添加新列（如果旧数据库存在）
  // 注意：在生产环境中应使用专门的迁移工具
  const columns = [
    'audio_path TEXT',
    'error_message TEXT',
    'failed_stage TEXT',
    'duration REAL', // 添加 duration 字段
    'display_name TEXT', // 添加 display_name 字段
    'file_hash TEXT', // 添加 file_hash 字段
    'transcription_progress REAL', // 转写进度 0–100，仅 transcribing 时有值
    'transcription_started_at DATETIME', // 转写开始时间
    'transcription_first_segment_at DATETIME', // 首次输出时间
    'scenario TEXT',
    'transcribe_meta TEXT' // JSON: { team_home_id?, team_away_id?, keywords? }
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
      media_file_id TEXT,
      content TEXT,
      format TEXT DEFAULT 'text',
      stream_translate_enabled BOOLEAN DEFAULT 0,
      stream_translate_status TEXT DEFAULT 'idle',
      stream_translate_language TEXT DEFAULT 'zh',
      stream_translate_updated_at DATETIME,
      stream_translate_error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (media_file_id) REFERENCES media_files(id)
    );
  `);

  if (!isTest) {
    ensureColumn('transcriptions', 'stream_translate_enabled', 'stream_translate_enabled BOOLEAN DEFAULT 0');
    ensureColumn('transcriptions', 'stream_translate_status', "stream_translate_status TEXT DEFAULT 'idle'");
    ensureColumn('transcriptions', 'stream_translate_language', "stream_translate_language TEXT DEFAULT 'zh'");
    ensureColumn('transcriptions', 'stream_translate_updated_at', 'stream_translate_updated_at DATETIME');
    ensureColumn('transcriptions', 'stream_translate_error', 'stream_translate_error TEXT');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS transcription_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transcription_id INTEGER NOT NULL,
      segment_index INTEGER NOT NULL,
      start_time REAL NOT NULL,
      end_time REAL NOT NULL,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transcription_id) REFERENCES transcriptions(id),
      UNIQUE(transcription_id, segment_index)
    );
  `);
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_transcription_segments_tid ON transcription_segments(transcription_id)');
  } catch (e: any) {
    // ignore
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS translation_segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transcription_id INTEGER NOT NULL,
      language TEXT NOT NULL,
      segment_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transcription_id) REFERENCES transcriptions(id),
      UNIQUE(transcription_id, language, segment_index)
    );
  `);
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_translation_segments_tid_lang ON translation_segments(transcription_id, language)');
  } catch (e: any) {
    // ignore
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      media_file_id TEXT,
      content TEXT,
      model TEXT,
      mode TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (media_file_id) REFERENCES media_files(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS translations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transcription_id INTEGER NOT NULL,
      language TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT,
      progress REAL,
      total_chunks INTEGER,
      completed_chunks INTEGER,
      started_at DATETIME,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (transcription_id) REFERENCES transcriptions(id),
      UNIQUE(transcription_id, language)
    );
  `);
  if (!isTest) {
    ensureColumn('translations', 'status', 'status TEXT');
    ensureColumn('translations', 'progress', 'progress REAL');
    ensureColumn('translations', 'total_chunks', 'total_chunks INTEGER');
    ensureColumn('translations', 'completed_chunks', 'completed_chunks INTEGER');
    ensureColumn('translations', 'started_at', 'started_at DATETIME');
    ensureColumn('translations', 'updated_at', 'updated_at DATETIME');
    // 兼容旧库：新增列后补默认值
    db.exec("UPDATE translations SET updated_at = datetime('now') WHERE updated_at IS NULL");
  }
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_translations_transcription_id ON translations(transcription_id)');
  } catch (e: any) {
    if (!e.message?.includes('already exists')) throw e;
  }

  // 配置表
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 球队名单表（转写提示词增强：足球场景选队 + 名单注入）
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      roster_text TEXT,
      starting_lineup_text TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  if (!isTest) {
    try {
      db.exec('ALTER TABLE teams ADD COLUMN starting_lineup_text TEXT');
    } catch (e: any) {
      if (!e.message?.includes('duplicate column name')) {
        // ignore
      }
    }
  }

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

      // 初始化默认 LLM 配置（若不存在）
      const existingLLM = db.prepare('SELECT value FROM settings WHERE key = ?').get('llm_config');
      if (!existingLLM) {
        const defaultLLM = JSON.stringify({
          provider: 'ollama',
          base_url: 'http://localhost:11434',
          model_name: 'qwen3:14b',
          translation_chunk_tokens: 1200,
          translation_overlap_tokens: 200,
          translation_context_tokens: 4096,
          translation_stream_batch_size: 5,
          translation_stream_context_lines: 3,
        });
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('llm_config', defaultLLM);
        console.log('[DB] Initialized default llm_config (ollama)');
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
