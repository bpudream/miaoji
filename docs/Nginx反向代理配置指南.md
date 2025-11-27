# Nginx 反向代理配置指南

## 概述

使用 Nginx 作为反向代理，统一前端和后端的访问入口，提升安全性和用户体验。

### 架构优势

```
用户浏览器 → Nginx (端口 80) → 统一入口
                    ↓
            ┌───────┴───────┐
            ↓               ↓
      前端静态文件      后端 API (localhost:13636)
      (dist 目录)      (内部转发，不暴露)
```

**好处：**
- ✅ 只需开放一个端口（80），更安全
- ✅ 后端不直接暴露，减少攻击面
- ✅ 用户访问更简单（无需输入端口号）
- ✅ 可以轻松添加 HTTPS、负载均衡等功能

## 安装 Nginx (Windows)

### 方法 1：下载官方版本（推荐）

1. 访问 https://nginx.org/en/download.html
2. 下载 **Windows 版本**（如 `nginx/Windows-1.xx.x`）
3. 解压到 `C:\nginx`（或任意目录）
4. 确保路径中没有空格和中文

### 方法 2：使用 Chocolatey

```powershell
# 以管理员身份运行 PowerShell
choco install nginx
```

## 配置 Nginx

### 1. 创建配置文件

在 Nginx 安装目录的 `conf` 文件夹中，创建 `miaoji.conf`：

```nginx
server {
    listen 80;
    server_name _;  # 接受所有域名/IP访问

    # 日志配置
    access_log logs/miaoji_access.log;
    error_log logs/miaoji_error.log;

    # 前端静态文件
    root C:/Users/bpudr/Documents/0.code/miaoji/web/dist;
    index index.html;

    # 前端路由支持（React Router）
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 后端 API 反向代理
    location /api/ {
        proxy_pass http://localhost:13636/api/;
        proxy_http_version 1.1;

        # 请求头设置
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 超时设置（大文件上传需要）
        proxy_connect_timeout 300s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;

        # 文件上传大小限制（4GB）
        client_max_body_size 4G;
    }

    # 健康检查端点（可选）
    location /health {
        proxy_pass http://localhost:13636/api/health;
        access_log off;
    }
}
```

### 2. 修改主配置文件

编辑 `conf/nginx.conf`：

1. **注释掉默认的 server 块**（第 35-79 行），避免端口冲突：
   ```nginx
   #server {
   #    listen       80;
   #    server_name  localhost;
   #    location / {
   #        root   html;
   #        index  index.html index.htm;
   #    }
   #}
   ```

2. **在 `http` 块的最后添加**（在最后的 `}` 之前）：
   ```nginx
   http {
       include       mime.types;
       default_type  application/octet-stream;
       sendfile        on;
       keepalive_timeout  65;

       # ... 其他配置 ...

       # 在最后包含我们的配置（推荐位置）
       include miaoji.conf;
   }
   ```

**为什么放在最后？**
- ✅ 确保我们的配置优先级更高
- ✅ 避免被其他配置覆盖
- ✅ 配置结构更清晰

**注意：** 请将 `miaoji.conf` 中的路径 `C:/Users/bpudr/Documents/0.code/miaoji/web/dist` 替换为您的实际项目路径。

## 构建前端

在部署前，需要先构建前端静态文件：

```bash
cd web
npm run build
```

构建完成后，静态文件会生成在 `web/dist` 目录中。

## 启动服务

### 1. 启动后端服务

```bash
cd server
npm run dev
# 或使用 PM2: pm2 start ecosystem.config.js
```

### 2. 启动 Nginx

```bash
# 进入 Nginx 安装目录
cd C:\nginx

# 测试配置是否正确
nginx.exe -t

# 启动 Nginx
nginx.exe

# 或使用服务方式（需要管理员权限）
nginx.exe -s start
```

### 3. 验证服务

- 访问前端：`http://localhost/miaoji` 或 `http://192.168.101.30/miaoji`
- 访问 API：`http://localhost/miaoji/api/health`（应该返回后端健康状态）

## 防火墙配置

现在只需要开放 **80 端口**（HTTP）：

```powershell
# 开放 HTTP 端口
New-NetFirewallRule -DisplayName "Miaoji HTTP (80)" -Direction Inbound -LocalPort 80 -Protocol TCP -Action Allow
```

**可以关闭的端口：**
- ❌ 13737（前端开发服务器端口，不再需要）
- ❌ 13636（后端端口，现在只内部访问）

## 常用 Nginx 命令

```bash
# 测试配置
nginx.exe -t

# 启动
nginx.exe

# 停止
nginx.exe -s stop

# 重新加载配置（不中断服务）
nginx.exe -s reload

# 查看进程
tasklist | findstr nginx
```

## 开发模式 vs 生产模式

### 开发模式（当前）

```bash
# 前端：开发服务器
cd web
npm run dev  # 运行在 13737 端口

# 后端：直接运行
cd server
npm run dev  # 运行在 13636 端口
```

**访问：** `http://192.168.101.30:13737`

### 生产模式（使用 Nginx）

```bash
# 1. 构建前端
cd web
npm run build

# 2. 启动后端
cd server
npm run dev  # 或使用 PM2

# 3. 启动 Nginx
cd C:\nginx
nginx.exe
```

**访问：** `http://192.168.101.30/miaoji`（无需端口号，部署在 /miaoji 路径下）

## 故障排查

### 1. Nginx 无法启动

- 检查端口 80 是否被占用：`netstat -ano | findstr :80`
- 检查配置文件语法：`nginx.exe -t`
- 查看错误日志：`logs/error.log`

### 2. 前端页面 404

- 确认 `web/dist` 目录存在且包含 `index.html`
- 检查 Nginx 配置中的 `alias` 路径是否正确（注意使用 `alias` 而不是 `root`）
- 确认已运行 `npm run build`
- 确认访问路径是 `/miaoji` 而不是根路径 `/`

### 3. API 请求失败

- 确认后端服务正在运行（`http://localhost:13636/api/health`）
- 检查 Nginx 配置中的 `proxy_pass` 地址
- 查看 Nginx 错误日志

### 4. 文件上传失败

- 检查 `client_max_body_size` 设置是否足够大
- 检查后端文件大小限制
- 查看 Nginx 和浏览器控制台错误信息

## 进阶配置（可选）

### 启用 HTTPS

如果需要 HTTPS，可以配置 SSL 证书：

```nginx
server {
    listen 443 ssl;
    ssl_certificate     cert.pem;
    ssl_certificate_key cert.key;
    # ... 其他配置 ...
}
```

### 自定义端口

如果 80 端口被占用，可以改用其他端口（如 8080）：

```nginx
server {
    listen 8080;
    # ... 其他配置 ...
}
```

记得更新防火墙规则。

## 总结

使用 Nginx 反向代理后：
- ✅ 更安全：后端不直接暴露
- ✅ 更简单：用户只需访问一个地址
- ✅ 更专业：符合生产环境最佳实践
- ✅ 更灵活：易于扩展（HTTPS、负载均衡等）

