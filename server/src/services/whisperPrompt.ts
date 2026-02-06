export type ScenarioKey = 'default' | 'education' | 'sports_football';

export interface PromptConfig {
  initialPrompt: string;
  conditionOnPreviousText?: boolean;
  compressionRatioThreshold?: number;
}

export interface BuildPromptMeta {
  team_home_name?: string;
  team_away_name?: string;
  roster_combined?: string;
  keywords?: string;
}

const PROMPT_CONFIGS: Record<ScenarioKey, PromptConfig> = {
  default: {
    initialPrompt: ''
  },
  education: {
    initialPrompt:
      '以下是一段关于教育教学的讲座录音。内容逻辑严密，包含学术术语。请忽略口语重复，保持标点符号的规范性，通过上下文准确识别专业名词。'
  },
  sports_football: {
    initialPrompt:
      "This is a live commentary of a football match. Expect excitement, fast speech, player names, and tactical terms like 'offside', 'penalty', 'corner kick', 'goal'. Do not filter out exclamations.",
    conditionOnPreviousText: false
  }
};

/** 关键词/名单部分最大字符数，避免超出 Whisper 对 prompt 的接受范围；约可容纳 30～50 个球员名 */
const MAX_KEYWORDS_CHARS = 450;
const MAX_PROMPT_CHARS = 800;

export const normalizeScenario = (value?: string | null): ScenarioKey => {
  const raw = (value || '').trim().toLowerCase();
  if (!raw || raw === 'default') return 'default';
  if (raw === 'education' || raw === 'edu' || raw === 'lecture') return 'education';
  if (
    raw === 'sports/football' ||
    raw === 'sports_football' ||
    raw === 'sports' ||
    raw === 'football'
  ) {
    return 'sports_football';
  }
  return 'default';
};

export const getPromptConfigForScenario = (scenario?: string | null): PromptConfig => {
  const key = normalizeScenario(scenario);
  return PROMPT_CONFIGS[key] ?? PROMPT_CONFIGS.default;
};

export interface PromptBuildResult {
  prompt: string;
  truncated: boolean;
  keywords_truncated: boolean;
}

/**
 * 构建转写用 initial_prompt：场景 + 文件名 + 对阵 + 关键词/名单，总长约 200 tokens 内。
 * 用户自定义关键词优先于球员名单。
 */
export function buildPromptWithMeta(
  filename: string,
  scenario: ScenarioKey,
  meta?: BuildPromptMeta | null
): PromptBuildResult {
  const parts: string[] = [];
  const config = PROMPT_CONFIGS[scenario] ?? PROMPT_CONFIGS.default;

  if (config.initialPrompt) {
    parts.push(config.initialPrompt);
  }

  const cleanName = (filename || '')
    .replace(/\.(mp4|mp3|wav|mkv|avi|mov|m4a|flac)$/gi, '')
    .replace(/_/g, ' ')
    .trim();
  if (cleanName) {
    parts.push(`Title: ${cleanName}.`);
  }

  if (scenario === 'sports_football' && meta?.team_home_name && meta?.team_away_name) {
    parts.push(`Match: ${meta.team_home_name} vs ${meta.team_away_name}.`);
  }

  const keywordsParts: string[] = [];
  if (meta?.keywords?.trim()) {
    keywordsParts.push(meta.keywords.trim());
  }
  if (meta?.roster_combined?.trim()) {
    keywordsParts.push(meta.roster_combined.trim());
  }

  let keywordsTruncated = false;
  if (keywordsParts.length > 0) {
    const combined = keywordsParts
      .join(', ')
      .replace(/\s+/g, ' ')
      .replace(/,+/g, ',')
      .trim();
    const safe = combined.length > MAX_KEYWORDS_CHARS ? combined.slice(0, MAX_KEYWORDS_CHARS) : combined;
    if (safe.length < combined.length) keywordsTruncated = true;
    parts.push(`Keywords: ${safe}.`);
  }

  let prompt = parts.join(' ').trim();
  let truncated = false;
  if (prompt.length > MAX_PROMPT_CHARS) {
    prompt = prompt.slice(0, MAX_PROMPT_CHARS);
    truncated = true;
  }
  if (keywordsTruncated) truncated = true;

  return { prompt, truncated, keywords_truncated: keywordsTruncated };
}

export function buildPrompt(
  filename: string,
  scenario: ScenarioKey,
  meta?: BuildPromptMeta | null
): string {
  return buildPromptWithMeta(filename, scenario, meta).prompt;
}
