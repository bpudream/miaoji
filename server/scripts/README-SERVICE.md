# Windows 服务安装指南

## 概述

本指南说明如何将 Miaoji 后端服务注册为 Windows 服务，实现开机自动启动和后台运行。

## 前置要求

1. **管理员权限**：所有服务相关操作都需要管理员权限
2. **Node.js**：已安装并添加到 PATH
3. **已构建服务**：运行 `npm run build` 生成 `dist/app.js`

## 快速开始

> **重要提示**：
> - **脚本可以从任何目录运行**：所有脚本使用绝对路径，不依赖当前工作目录
> - **查看日志需要从 server 目录运行**：或使用绝对路径

### 1. 下载 NSSM（如果还没有）

```bash
# 方法 1：使用下载脚本（推荐）
# 从 server 目录运行
tools\download-nssm.bat

# 方法 2：手动下载
# 访问 https://nssm.cc/download
# 下载 nssm-2.24.zip
# 解压 nssm.exe 到 server\tools\nssm.exe
```

### 2. 验证路径（可选）

```bash
# 可以从任何目录运行（脚本会自动找到 server 目录）
D:\path\to\server\scripts\verify-paths.bat

# 或者从 server 目录运行
cd D:\path\to\server
scripts\verify-paths.bat
```

### 3. 安装服务

```bash
# 右键以管理员身份运行
# 可以从任何目录运行
D:\path\to\server\scripts\install-service.bat

# 或者从 server 目录运行
cd D:\path\to\server
scripts\install-service.bat
```

安装脚本会：
- ✅ 检查 Node.js 和必要文件
- ✅ 配置服务参数
- ✅ 设置自动启动
- ✅ 配置自动重启
- ✅ 设置日志输出

### 4. 启动服务

```bash
# 方法 1：使用脚本
scripts\start-service.bat

# 方法 2：使用 Windows 命令
net start MiaojiBackend

# 方法 3：使用服务管理器
services.msc
# 找到 "Miaoji Backend Service"，右键启动
```

### 5. 验证服务

```bash
# 检查服务状态
sc query MiaojiBackend

# 检查服务日志（从 server 目录运行）
type logs\service-out.log
# 或使用绝对路径
type D:\path\to\server\logs\service-out.log

# 测试 API
curl http://localhost:3000/api/health
```

## 常用操作

### 启动服务
```bash
# 可以从任何目录运行
scripts\start-service.bat
# 或使用完整路径
D:\path\to\server\scripts\start-service.bat
# 或使用 Windows 命令（可从任何目录运行）
net start MiaojiBackend
```

### 停止服务
```bash
# 可以从任何目录运行
scripts\stop-service.bat
# 或使用完整路径
D:\path\to\server\scripts\stop-service.bat
# 或使用 Windows 命令（可从任何目录运行）
net stop MiaojiBackend
```

### 重启服务
```bash
# 可以从任何目录运行
scripts\restart-service.bat
# 或使用完整路径
D:\path\to\server\scripts\restart-service.bat
```

### 查看服务状态
```bash
sc query MiaojiBackend
```

### 查看服务日志
```bash
# 方法 1：从 server 目录运行（使用相对路径）
cd D:\path\to\server
type logs\service-out.log
type logs\service-err.log

# 方法 2：使用绝对路径（可从任何目录运行）
type D:\path\to\server\logs\service-out.log
type D:\path\to\server\logs\service-err.log
```

### 卸载服务
```bash
# 右键以管理员身份运行
# 可以从任何目录运行
scripts\uninstall-service.bat
# 或使用完整路径
D:\path\to\server\scripts\uninstall-service.bat
```

## 服务配置

### 服务名称
- **服务名**：`MiaojiBackend`
- **显示名**：`Miaoji Backend Service`
- **描述**：`Miaoji Backend Service for transcription and AI processing`

### 自动启动
服务已配置为自动启动，系统启动时会自动运行。

### 自动重启
如果服务崩溃，NSSM 会在 5 秒后自动重启。

### 日志位置
- **标准输出**：`server\logs\service-out.log`（相对于 server 目录）
- **错误输出**：`server\logs\service-err.log`（相对于 server 目录）
- **日志轮转**：每天或超过 10MB 时自动轮转

### 环境变量
服务会从 `server\.env` 文件读取环境变量。如果文件不存在，使用默认值：
- `BACKEND_PORT=3000`
- `PYTHON_WORKER_PATH=python/worker.py`（可选）
- `PYTHON_PATH=`（可选，自动检测）
- `MODEL_PATH=../models/large-v3`（可选）

## 故障排查

### 服务无法启动

1. **检查服务状态**
   ```bash
   sc query MiaojiBackend
   ```

2. **查看日志**
   ```bash
   type logs\service-err.log
   ```

3. **检查文件路径**
   - 确认 `dist\app.js` 存在
   - 确认 Node.js 在 PATH 中

4. **手动测试**
   ```bash
   cd server
   node dist\app.js
   ```

5. **验证路径**
   ```bash
   scripts\verify-paths.bat
   ```

### 服务启动后立即停止

1. **检查端口占用**
   ```bash
   netstat -ano | findstr :3000
   ```

2. **检查依赖**
   - 确认 Python、FFmpeg 等依赖已安装
   - 查看启动时的依赖检查输出

3. **查看详细日志**
   ```bash
   type logs\service-err.log
   ```

### 修改服务配置

使用 NSSM GUI：
```bash
# 从 server 目录运行
tools\nssm.exe edit MiaojiBackend
```

或使用命令行：
```bash
# 从 server 目录运行
# 修改工作目录
tools\nssm.exe set MiaojiBackend AppDirectory "C:\path\to\server"

# 修改环境变量
tools\nssm.exe set MiaojiBackend AppEnvironmentExtra "BACKEND_PORT=3000"

# 修改启动类型
tools\nssm.exe set MiaojiBackend Start SERVICE_AUTO_START
```

## 高级配置

### 修改服务端口

1. 编辑 `server\.env` 文件：
   ```bash
   BACKEND_PORT=3000
   ```

2. 重启服务：
   ```bash
   scripts\restart-service.bat
   ```

### 禁用自动启动

```bash
# 从 server 目录运行
tools\nssm.exe set MiaojiBackend Start SERVICE_DEMAND_START
```

### 修改重启延迟

```bash
# 从 server 目录运行
# 设置为 10 秒
tools\nssm.exe set MiaojiBackend AppRestartDelay 10000
```

## 与前端集成

服务安装后，前端可以通过以下方式监控服务状态：

1. **健康检查 API**
   ```javascript
   fetch('http://localhost:3000/api/health')
   ```

2. **系统状态 API**
   ```javascript
   fetch('http://localhost:3000/api/system/status')
   ```

如果服务未运行，前端可以提示用户：
- "后端服务未运行，请运行 scripts\start-service.bat 启动服务"
- 或提供重启服务的快捷方式

## 注意事项

1. **管理员权限**：安装/卸载服务需要管理员权限
2. **路径问题**：确保所有路径使用绝对路径或相对于服务工作目录
3. **环境变量**：服务运行时的环境变量可能与命令行不同
4. **日志管理**：定期清理日志文件，避免占用过多磁盘空间

## 卸载服务

```bash
# 右键以管理员身份运行
scripts\uninstall-service.bat
```

卸载后：
- ✅ 服务从 Windows 服务列表中移除
- ✅ 服务停止运行
- ✅ 日志文件保留（在 `server\logs\` 目录）

## 脚本说明

所有脚本都在 `scripts\` 目录下：

- **install-service.bat** - 安装 Windows 服务（需要管理员权限和 nssm.exe）
- **uninstall-service.bat** - 卸载 Windows 服务（需要管理员权限，nssm.exe 可选）
- **start-service.bat** - 启动服务（不需要 nssm.exe）
- **stop-service.bat** - 停止服务（不需要 nssm.exe）
- **restart-service.bat** - 重启服务（不需要 nssm.exe）
- **verify-paths.bat** - 验证路径和文件（不需要 nssm.exe）

### 运行方式

**所有脚本都可以从任何目录运行**，因为脚本使用 `%~dp0` 自动获取脚本所在目录，然后自动找到 server 目录。

```bash
# 方式 1：从 server 目录运行（推荐，更简洁）
cd D:\path\to\server
scripts\start-service.bat

# 方式 2：从任何目录运行（使用完整路径）
D:\path\to\server\scripts\start-service.bat

# 方式 3：从任何目录运行（如果 scripts 在 PATH 中）
start-service.bat
```

**注意**：
- ✅ 脚本本身不依赖当前工作目录
- ✅ 只有安装和卸载脚本需要 nssm.exe
- ⚠️ 查看日志需要使用绝对路径，或从 server 目录运行

## 参考资源

- [NSSM 官方文档](https://nssm.cc/usage)
- [Windows 服务管理](https://docs.microsoft.com/windows-server/administration/windows-commands/sc-query)

