import { useEffect, useState } from 'react';
import { Bot, Key, RefreshCw, Save } from 'lucide-react';
import {
  getLLMSettings,
  updateLLMSettings,
  testLLMConnection,
  type LLMSettings,
  type LLMProviderType,
} from '../lib/api';

const PROVIDER_OPTIONS: { value: LLMProviderType; label: string }[] = [
  { value: 'ollama', label: '本地模型 (Ollama)' },
  { value: 'openai', label: '在线模型 (DeepSeek)' },
];

export const LLMConfigCard = () => {
  const [config, setConfig] = useState<LLMSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // 表单状态（API Key 仅在前端占位，不回显明文）
  const [provider, setProvider] = useState<LLMProviderType>('ollama');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelName, setModelName] = useState('');
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [translationChunkTokens, setTranslationChunkTokens] = useState('');
  const [translationOverlapTokens, setTranslationOverlapTokens] = useState('');
  const [translationContextTokens, setTranslationContextTokens] = useState('');

  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getLLMSettings();
      setConfig(data);
      setProvider(data.provider);
      setBaseUrl(data.base_url ?? '');
      setModelName(data.model_name ?? '');
      setTranslationChunkTokens(
        data.translation_chunk_tokens != null ? String(data.translation_chunk_tokens) : ''
      );
      setTranslationOverlapTokens(
        data.translation_overlap_tokens != null ? String(data.translation_overlap_tokens) : ''
      );
      setTranslationContextTokens(
        data.translation_context_tokens != null ? String(data.translation_context_tokens) : ''
      );
      setApiKeyInput(''); // 不回显 API Key，仅占位
    } catch (e: any) {
      setError(e?.response?.data?.error || '加载配置失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccessMsg(null);
    setTestResult(null);
    try {
      const payload: Parameters<typeof updateLLMSettings>[0] = {
        provider,
        base_url: baseUrl.trim() || undefined,
        model_name: modelName.trim() || undefined,
      };
      const chunkTokens = parseInt(translationChunkTokens, 10);
      if (!Number.isNaN(chunkTokens)) payload.translation_chunk_tokens = chunkTokens;
      const overlapTokens = parseInt(translationOverlapTokens, 10);
      if (!Number.isNaN(overlapTokens)) payload.translation_overlap_tokens = overlapTokens;
      const contextTokens = parseInt(translationContextTokens, 10);
      if (!Number.isNaN(contextTokens)) payload.translation_context_tokens = contextTokens;
      if (provider === 'openai' && apiKeyInput.trim()) {
        payload.api_key = apiKeyInput.trim();
      }
      await updateLLMSettings(payload);
      setSuccessMsg('保存成功，配置已生效');
      setConfig(await getLLMSettings());
      setApiKeyInput(''); // 清空输入框，避免误以为会回显
    } catch (e: any) {
      setError(e?.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setError(null);
    try {
      // 先保存当前表单再测试，确保后端用最新配置测试
      const payload: Parameters<typeof updateLLMSettings>[0] = {
        provider,
        base_url: baseUrl.trim() || undefined,
        model_name: modelName.trim() || undefined,
      };
      const chunkTokens = parseInt(translationChunkTokens, 10);
      if (!Number.isNaN(chunkTokens)) payload.translation_chunk_tokens = chunkTokens;
      const overlapTokens = parseInt(translationOverlapTokens, 10);
      if (!Number.isNaN(overlapTokens)) payload.translation_overlap_tokens = overlapTokens;
      const contextTokens = parseInt(translationContextTokens, 10);
      if (!Number.isNaN(contextTokens)) payload.translation_context_tokens = contextTokens;
      if (provider === 'openai' && apiKeyInput.trim()) payload.api_key = apiKeyInput.trim();
      await updateLLMSettings(payload);
      const result = await testLLMConnection();
      setTestResult(result);
    } catch (e: any) {
      const msg = e?.response?.data?.message ?? e?.message ?? '测试请求失败';
      setTestResult({ success: false, message: msg });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
        <p className="text-sm text-gray-500">加载中…</p>
      </div>
    );
  }

  const isOpenAI = provider === 'openai';
  const defaultModel = isOpenAI ? 'deepseek-chat' : 'qwen3:14b';
  const displayModel = modelName.trim() || defaultModel;

  return (
    <div className="rounded-xl border border-gray-100 bg-white p-6 shadow-sm">
      <div className="mb-4 flex items-center gap-2 border-b border-gray-100 pb-3">
        <Bot className="h-5 w-5 text-gray-600" />
        <h3 className="text-base font-semibold text-gray-800">AI 模型设置</h3>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}
      {successMsg && (
        <div className="mb-4 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
          {successMsg}
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">模型类型</label>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value as LLMProviderType)}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {PROVIDER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {isOpenAI && (
          <>
            <div>
              <label className="mb-1 flex items-center gap-1 text-sm font-medium text-gray-700">
                <Key className="h-4 w-4" />
                API Key
              </label>
              <input
                type="password"
                value={apiKeyInput}
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={config?.api_key_set ? '已设置，输入新值可覆盖' : '请输入 DeepSeek API Key'}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Base URL（可选）</label>
              <input
                type="url"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.deepseek.com"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </>
        )}

        {!isOpenAI && (
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Ollama 地址（可选）</label>
            <input
              type="url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://localhost:11434"
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        <div>
          <label className="mb-1 block text-sm font-medium text-gray-700">模型名称</label>
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder={defaultModel}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p className="mt-1 text-xs text-gray-500">
            当前将使用：{displayModel || defaultModel}
          </p>
        </div>

        <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
          <div className="mb-2 text-sm font-medium text-gray-700">翻译分块参数（可选）</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs text-gray-600">Chunk Tokens</label>
              <input
                type="number"
                min={100}
                value={translationChunkTokens}
                onChange={(e) => setTranslationChunkTokens(e.target.value)}
                placeholder="例如 1200"
                className="w-full rounded-md border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Overlap Tokens</label>
              <input
                type="number"
                min={0}
                value={translationOverlapTokens}
                onChange={(e) => setTranslationOverlapTokens(e.target.value)}
                placeholder="例如 200"
                className="w-full rounded-md border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Context Tokens</label>
              <input
                type="number"
                min={512}
                value={translationContextTokens}
                onChange={(e) => setTranslationContextTokens(e.target.value)}
                placeholder="例如 4096"
                className="w-full rounded-md border border-gray-200 px-2.5 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            留空将使用默认值；本地 14B 建议更小的 chunk 和 overlap。
          </p>
        </div>
      </div>

      {testResult && (
        <div
          className={`mt-4 rounded-lg px-3 py-2 text-sm ${
            testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
          }`}
        >
          {testResult.message}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${testing ? 'animate-spin' : ''}`} />
          {testing ? '测试中…' : '连接测试'}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
};
