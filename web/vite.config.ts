import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 生产环境构建配置：部署在 /miaoji 路径下
  base: process.env.NODE_ENV === 'production' ? '/miaoji/' : '/',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
  server: {
    host: '0.0.0.0', // 明确监听所有网络接口，允许局域网访问
    port: 13737, // 前端开发服务器端口
  },
})
