import { useState, useEffect } from 'react';

// 默认后端端口配置（根据环境区分）
// 开发环境使用 3000，生产环境使用 13636
const getDefaultBackendPort = (): string => {
  // 使用 Vite 的环境变量判断
  if (import.meta.env.PROD) {
    return '13636'; // 生产环境
  }
  return '3000'; // 开发环境
};

const DEFAULT_BACKEND_PORT = getDefaultBackendPort();

// 判断是否为生产环境（通过 Nginx 反向代理访问）
const isProductionMode = (): boolean => {
  if (typeof window === 'undefined') return false;

  // 如果通过标准 HTTP 端口（80）或 HTTPS 端口（443）访问，认为是生产环境
  const port = window.location.port;
  return !port || port === '80' || port === '443';
};

// 获取后端基础 URL 的 Hook
export const useBackendUrl = () => {
  const [backendUrl, setBackendUrl] = useState<string>('');
  const [backendPort, setBackendPort] = useState<string>(DEFAULT_BACKEND_PORT);

  useEffect(() => {
    // 1. 获取后端端口配置
    // 优先使用环境变量，否则根据当前环境使用默认端口
    let port = getDefaultBackendPort();
    const envUrl = import.meta.env.VITE_BACKEND_URL;

    if (envUrl) {
      try {
        const urlObj = new URL(envUrl);
        if (urlObj.port) {
          port = urlObj.port;
        }
      } catch (e) {
        // 忽略 URL 解析错误
      }
    }

    setBackendPort(port);

    // 2. 动态构建后端 URL
    if (isProductionMode()) {
      // 生产环境：通过 Nginx 反向代理，使用相对路径
      // API 请求会被 Nginx 转发到后端，无需指定端口
      setBackendUrl('');
    } else if (typeof window !== 'undefined' &&
        window.location.hostname !== 'localhost' &&
        window.location.hostname !== '127.0.0.1') {
      // 开发环境 + 局域网访问：使用当前 IP + 后端端口
      setBackendUrl(`${window.location.protocol}//${window.location.hostname}:${port}`);
    } else {
      // 本地开发环境：使用环境变量或 localhost
      if (envUrl) {
        setBackendUrl(envUrl.replace(/\/+$/, ''));
      } else {
        setBackendUrl(`http://localhost:${port}`);
      }
    }
  }, []);

  return { backendUrl, backendPort };
};

// 兼容旧的静态获取方法（用于非 React 组件环境，如 axios 实例创建）
export const getBackendUrlStatic = (): string => {
  // 优先使用环境变量，否则根据当前环境使用默认端口
  let port = getDefaultBackendPort();
  const envUrl = (import.meta.env as any).VITE_BACKEND_URL as string | undefined;

  if (envUrl) {
    try {
      const urlObj = new URL(envUrl);
      if (urlObj.port) {
        port = urlObj.port;
      }
    } catch (e) { }
  }

  // 生产环境：使用相对路径（通过 Nginx 代理）
  if (isProductionMode()) {
    return '';
  }

  if (typeof window !== 'undefined' &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1') {
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }

  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }

  return `http://localhost:${port}`;
};
