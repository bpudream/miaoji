import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { getSystemStatus, SystemStatus, testConnection, getBackendUrlConfig, testBackendConnection } from '../lib/api';
import { useBackendUrl } from '../hooks/useBackendUrl';
import { Copy, Check, Server, Smartphone, Globe, AlertCircle, RefreshCw, CheckCircle2, Box, Cpu } from 'lucide-react';

export const SettingsPage = () => {
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIP, setSelectedIP] = useState<string | null>(null);
  const { backendPort } = useBackendUrl(); // 使用 Hook 获取配置的后端端口

  // 状态检查
  const [backendHealth, setBackendHealth] = useState<{ status: 'ok' | 'error' | 'checking'; message?: string }>({ status: 'checking' });
  const [networkHealth, setNetworkHealth] = useState<{ status: 'ok' | 'error' | 'checking'; message?: string }>({ status: 'checking' });

  const [copied, setCopied] = useState(false);

  useEffect(() => {
    loadSystemInfo();
  }, []);

  useEffect(() => {
    if (systemStatus && !selectedIP) {
      setSelectedIP(systemStatus.defaultIP);
    }
  }, [systemStatus]);

  useEffect(() => {
    if (selectedIP) {
      checkNetworkAccessibility(selectedIP);
    }
  }, [selectedIP]); // 移除 systemStatus 依赖，因为端口直接从 window 获取

  const loadSystemInfo = async () => {
    setLoading(true);
    try {
      const status = await getSystemStatus();
      setSystemStatus(status);

      // 并行检查后端健康状态
      checkBackendHealth();
    } catch (error) {
      console.error('Failed to load system status:', error);
    } finally {
      setLoading(false);
    }
  };

  const checkBackendHealth = async () => {
    setBackendHealth({ status: 'checking' });
    try {
      const result = await testBackendConnection();
      setBackendHealth({
        status: result.success ? 'ok' : 'error',
        message: result.message
      });
    } catch (error) {
      setBackendHealth({ status: 'error', message: '连接失败' });
    }
  };

  const checkNetworkAccessibility = async (ip: string) => {
    const port = window.location.port || (window.location.protocol === 'https:' ? '443' : '80');

    setNetworkHealth({ status: 'checking' });
    try {
      const result = await testConnection(ip, port);
      setNetworkHealth({
        status: result.success ? 'ok' : 'error',
        message: result.success ? '网络可访问' : '网络可能不可达 (防火墙?)'
      });
    } catch (error) {
      setNetworkHealth({ status: 'error', message: '测试失败' });
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const getCurrentFrontendUrl = () => {
    if (!selectedIP) return '';
    const port = window.location.port;
    const protocol = window.location.protocol;
    const basePath = import.meta.env.PROD ? '/miaoji' : '';
    return `${protocol}//${selectedIP}${port ? `:${port}` : ''}${basePath}`;
  };

  if (loading && !systemStatus) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500 flex items-center gap-2">
          <RefreshCw className="w-5 h-5 animate-spin" />
          <span>加载系统配置...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 md:space-y-8 p-4 md:p-0 pb-20 md:pb-0">
      <div>
        <h2 className="text-xl md:text-2xl font-bold text-gray-800">系统设置</h2>
        <p className="text-xs md:text-base text-gray-500 mt-1">管理系统连接与服务状态</p>
      </div>

      {/* 1. 移动端访问/分享 (用户核心需求) */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 md:p-6 border-b border-gray-100 flex items-center gap-3">
          <div className="p-2 bg-blue-50 rounded-lg">
            <Smartphone className="w-5 h-5 md:w-6 md:h-6 text-blue-600" />
          </div>
          <div>
            <h3 className="text-base md:text-lg font-medium text-gray-900">移动端访问</h3>
            <p className="text-xs md:text-sm text-gray-500">在局域网内的其他设备上访问此系统</p>
          </div>
        </div>

        <div className="p-4 md:p-6">
          <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start">
            {/* 左侧：二维码 */}
            <div className="bg-white p-3 md:p-4 rounded-xl border border-gray-200 shadow-sm flex-shrink-0 mx-auto md:mx-0">
              <QRCodeSVG
                value={getCurrentFrontendUrl()}
                size={160}
                level="M"
                includeMargin={true}
              />
              <p className="text-center text-xs text-gray-400 mt-2">扫码直接访问</p>
            </div>

            {/* 右侧：配置与链接 */}
            <div className="flex-1 space-y-6 w-full">
              {/* 网络接口选择 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  访问地址 (局域网 IP)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <select
                      value={selectedIP || ''}
                      onChange={(e) => setSelectedIP(e.target.value)}
                      className="w-full appearance-none bg-gray-50 border border-gray-200 text-gray-700 py-2.5 px-4 pr-8 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono text-sm"
                    >
                      {systemStatus?.interfaces.map((iface) => (
                        <option key={iface.ip} value={iface.ip}>
                          {iface.ip} ({iface.type === 'wifi' ? 'WiFi' : iface.type === 'ethernet' ? '以太网' : '其他'})
                        </option>
                      ))}
                    </select>
                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                      <svg className="fill-current h-4 w-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="M9.293 12.95l.707.707L15.657 8l-1.414-1.414L10 10.828 5.757 6.586 4.343 8z"/></svg>
                    </div>
                  </div>

                  <button
                    onClick={() => copyToClipboard(getCurrentFrontendUrl())}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2 font-medium text-sm"
                  >
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copied ? '已复制' : '复制链接'}
                  </button>
                </div>
              </div>

              {/* 连接状态提示 */}
              <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${
                networkHealth.status === 'ok' ? 'bg-green-50 text-green-700' :
                networkHealth.status === 'checking' ? 'bg-gray-50 text-gray-600' :
                'bg-yellow-50 text-yellow-700'
              }`}>
                {networkHealth.status === 'checking' ? (
                  <RefreshCw className="w-4 h-4 animate-spin mt-0.5" />
                ) : networkHealth.status === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 mt-0.5" />
                )}
                <div>
                  <p className="font-medium">
                    {networkHealth.status === 'checking' ? '正在检测网络连通性...' :
                     networkHealth.status === 'ok' ? '网络连接正常' : '连接可能受限'}
                  </p>
                  {networkHealth.status === 'error' && (
                    <p className="text-xs mt-1 opacity-90">
                      服务器无法回连此 IP。请检查防火墙设置，或者确保手机与电脑连接同一 WiFi。
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-gray-400">
                <Globe className="w-3 h-3" />
                <span>请确保访问设备与本机在同一局域网下</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. 服务状态 (系统健康) */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-4 md:p-6 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 rounded-lg">
              <Server className="w-5 h-5 md:w-6 md:h-6 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-base md:text-lg font-medium text-gray-900">服务状态</h3>
              <p className="text-xs md:text-sm text-gray-500">关键服务组件运行状态检测</p>
            </div>
          </div>
          <button
            onClick={() => { loadSystemInfo(); }}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-full transition-colors"
            title="刷新状态"
          >
            <RefreshCw className={`w-4 h-4 md:w-5 md:h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="p-4 md:p-6 grid gap-4 md:gap-6 md:grid-cols-2">
          {/* 后端服务 (主服务) */}
          <div className="border border-gray-100 rounded-lg p-4 bg-gray-50/50 col-span-2 md:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">后端 API 服务</span>
              </div>
              <span className={`flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full ${
                backendHealth.status === 'ok' ? 'bg-green-100 text-green-700' :
                backendHealth.status === 'checking' ? 'bg-gray-200 text-gray-600' :
                'bg-red-100 text-red-700'
              }`}>
                {backendHealth.status === 'ok' && <div className="w-1.5 h-1.5 rounded-full bg-green-500" />}
                {backendHealth.status === 'error' && <div className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                {backendHealth.status === 'ok' ? '运行中' :
                 backendHealth.status === 'checking' ? '检测中' : '异常'}
              </span>
            </div>

            <div className="space-y-2 text-sm text-gray-600">
              <div className="flex justify-between">
                <span className="text-gray-400">地址</span>
                <span className="font-mono">{getBackendUrlConfig()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">端口</span>
                <span className="font-mono">{backendPort}</span>
              </div>
              {backendHealth.message && backendHealth.status !== 'ok' && (
                <div className="mt-2 text-xs text-red-500 bg-red-50 p-2 rounded">
                  {backendHealth.message}
                </div>
              )}
            </div>
          </div>

          {/* Whisper 引擎 (占位) */}
          <div className="border border-gray-100 rounded-lg p-4 bg-gray-50/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Box className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Faster Whisper</span>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-gray-100 text-gray-500">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                未知
              </span>
            </div>
            <div className="text-xs text-gray-400">
              语音转写引擎，负责将音频转换为文本。
            </div>
          </div>

          {/* Ollama 引擎 (占位) */}
          <div className="border border-gray-100 rounded-lg p-4 bg-gray-50/50">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Cpu className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-700">Ollama</span>
              </div>
              <span className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full bg-gray-100 text-gray-500">
                <div className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                未知
              </span>
            </div>
            <div className="text-xs text-gray-400">
              大语言模型服务，负责生成内容摘要。
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
