# 妙记（MiaoJi）

> 基于 AI 的本地化音视频智能转写与总结工具 (仿飞书妙计)

<div align="center">

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/server-Windows-blue.svg)
![Client](https://img.shields.io/badge/client-Browser-green.svg)
![Status](https://img.shields.io/badge/status-Planning-yellow.svg)

</div>

## 📖 项目简介

妙记是一款**基于本地 AI 的**音视频转文字与智能总结工具。采用前后端分离架构，后端服务运行在 Windows 主机上，利用本地 GPU 硬件（RTX 4070 TI Super）进行高速 AI 处理；前端通过浏览器访问，支持局域网内所有设备使用，无需安装客户端。

### ✨ 核心特性

- 🎯 **高精度转写**: 基于 OpenAI Whisper 模型，中英文识别准确率 ≥95%
- ⚡ **极速处理**: GPU 加速，转写速度可达 15-20x 实时速度
- 🤖 **智能总结**: 本地 LLM（Qwen3-14B），快速生成摘要和要点
- 🔒 **隐私保护**: 所有处理在本地服务器完成，数据不出局域网
- 💰 **零运营成本**: 无 API 调用费用，长期零成本使用
- 🌐 **多设备访问**: 浏览器直接访问，支持 Windows/Mac/平板/手机
- 📤 **无需安装**: 客户端零安装，打开浏览器即用
- 🏠 **局域网共享**: 家庭内多设备共享同一个 GPU 服务器

### 🎯 适用场景

- 📝 **会议记录**: 自动转写会议录音，生成会议纪要
- 🎓 **课程学习**: 转写课程视频，提取学习要点
- 🎤 **采访整理**: 快速整理采访内容，生成结构化文稿
- 📺 **视频字幕**: 为视频内容生成字幕文件（SRT）
- 🔍 **内容分析**: 批量处理音视频，进行内容分析

## 🚀 快速开始

### 系统要求

**服务端（Windows 主机）**:
- Windows 10/11 (x64)
- 6 核+ CPU（如 i5-13600KF）
- 16GB+ RAM
- NVIDIA GPU（如 RTX 4070 TI Super，支持 CUDA）
- 20GB+ 可用磁盘空间

**客户端（任何设备）**:
- 现代浏览器（Chrome/Edge/Firefox/Safari）
- 连接到同一局域网
- 无需安装任何软件

### 部署（服务端）

> ⚠️ 项目当前处于规划阶段，尚未发布可用版本

**未来部署方式**:
```bash
# 1. 安装依赖
npm install -g pm2
pip install faster-whisper
# 安装 Ollama

# 2. 下载模型
ollama pull qwen3:14b

# 3. 启动服务
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # 开机自启动
```

### 使用流程

```
1. 浏览器访问 http://192.168.x.x:8080
2. 上传音视频文件
3. 自动转写
4. 查看/编辑文字稿
5. 生成 AI 总结
6. 导出结果
```

## 📚 文档

- [需求分析](docs/0.需求分析.md) - 详细的功能需求和用户场景
- [技术架构设计](docs/1.技术架构设计.md) - 完整的技术架构和实现方案

## 🛠 技术栈

### 架构

```
浏览器客户端 (React)  ←→  Windows 服务端 (Node.js + Python)
      ↓                              ↓
  无需安装                    faster-whisper + Ollama
  任何设备                    GPU 加速处理
```

### 核心技术

**后端服务**:
- Fastify / Express (Node.js)
- Python 3.10+ (AI 处理)
- faster-whisper (语音识别)
- Ollama + Qwen3-14B (LLM)
- FFmpeg (音视频处理)
- SQLite (数据库)

**前端应用**:
- React 18 + TypeScript
- Tailwind CSS
- Zustand (状态管理)
- axios + WebSocket

### 为什么选择这个架构？

#### ✅ Web 应用 vs Electron
- 无需客户端安装，浏览器直接访问
- Mac 用户无需单独打包，直接浏览器使用
- 多设备共享同一个 GPU 服务器
- 维护成本低，服务端统一更新

#### ✅ faster-whisper
- OpenAI Whisper 模型，业界最高精度
- 4x 速度提升（相比原版 Whisper）
- 完美的 CUDA 支持

#### ✅ Ollama + Qwen3-14B
- 一键安装，易于管理
- Qwen 系列对中文支持最佳，14B 模型逻辑推理能力显著提升
- REST API，集成简单
- 串行执行模式，16GB 显存完美运行

## 🏗 项目结构（规划）

```
miaoji/
├── server/                  # 后端服务（Windows）
│   ├── src/
│   │   ├── api/            # API 路由
│   │   ├── services/       # 业务逻辑
│   │   ├── workers/        # Python Worker 管理
│   │   └── database/       # 数据库操作
│   ├── python/             # Python AI 模块
│   │   ├── asr_worker.py
│   │   └── requirements.txt
│   ├── uploads/            # 上传文件目录
│   ├── models/             # AI 模型缓存
│   └── package.json
│
├── web/                    # 前端应用（浏览器）
│   ├── src/
│   │   ├── components/    # React 组件
│   │   ├── pages/         # 页面
│   │   ├── services/      # API 客户端
│   │   ├── stores/        # 状态管理
│   │   └── utils/         # 工具函数
│   └── package.json
│
├── docs/                   # 文档
│   ├── 0.需求分析.md
│   └── 1.技术架构设计.md
│
└── README.md
```

## 📈 开发计划

### 阶段 1: 环境搭建（Week 1-2）
- [x] 完成技术方案设计
- [ ] 开发环境配置
- [ ] 核心技术验证（faster-whisper, Ollama）
- [ ] 项目脚手架搭建

### 阶段 2: MVP 开发（Week 3-6）
- [ ] 后端 API 服务器
- [ ] 文件上传功能
- [ ] ASR 集成（faster-whisper）
- [ ] 前端基础 UI
- [ ] WebSocket 实时通信

### 阶段 3: LLM 与编辑功能（Week 7-9）
- [ ] Ollama LLM 集成
- [ ] 转写结果编辑器
- [ ] AI 总结功能
- [ ] 多格式导出

### 阶段 4: 部署与优化（Week 10-12）
- [ ] PM2 生产部署
- [ ] 局域网测试
- [ ] 性能优化
- [ ] 文档完善

**预计开发周期**: 2-3 个月

## 🎯 性能指标

### 目标性能

| 指标 | 目标值 | 说明 |
|------|--------|------|
| 转写速度 | ≥15x 实时速度 | 10 分钟音频 < 40 秒 |
| 识别准确率 | ≥95% | 中英文标准语音 |
| AI 总结速度 | ≥50 tokens/s | 流畅的实时生成体验 |
| GPU 利用率 | ≥80% | 充分利用硬件资源 |
| API 响应时间 | <100ms | 不含 AI 处理时间 |
| 并发支持 | 3-5 设备 | 局域网同时访问 |
| 文件上传速度 | 50-100MB/s | 局域网传输 |

### 预期效果（基于 RTX 4070 TI Super）

- **10 分钟音频**: 转写 < 40 秒
- **1 小时音频**: 转写 < 4 分钟
- **AI 总结**: 5000 字文本 < 10 秒
- **成本**: 电费约 ¥0.5/小时（GPU 满载）
- **多设备**: 3-5 台设备可同时使用

## 🔐 隐私与安全

### 数据处理原则

- ✅ **完全本地**: 所有 AI 处理在本地服务器完成
- ✅ **局域网隔离**: 数据不出家庭网络，不上传外部云端
- ✅ **用户可控**: 所有数据存储在本地，可随时删除
- ✅ **简单安全**: 可选密码保护，防止误访问

### 与云端方案对比

| 维度 | 妙记（局域网） | 云端方案 |
|------|--------------|---------|
| 数据隐私 | ✅ 完全本地 | ❌ 上传云端 |
| 长期成本 | ✅ 零成本 | ❌ 持续付费 |
| 处理速度 | ✅ GPU 加速 | ⚠️ 依赖网络 |
| 多设备使用 | ✅ 局域网共享 | ✅ 支持 |
| 准确率 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 客户端安装 | ✅ 无需安装 | ✅ 无需安装 |

## 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

### 如何贡献

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 开启 Pull Request

## 📄 开源许可

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

### 第三方依赖许可

- **Whisper**: MIT License (OpenAI)
- **Qwen3**: Apache 2.0 License (Alibaba)
- **React**: MIT License
- **Node.js**: MIT License
- **其他依赖**: 各自的开源许可证

## 🙏 致谢

- [OpenAI Whisper](https://github.com/openai/whisper) - 优秀的开源语音识别模型
- [faster-whisper](https://github.com/guillaumekln/faster-whisper) - 高性能 Whisper 实现
- [Ollama](https://ollama.ai/) - 简化本地 LLM 部署
- [Qwen](https://github.com/QwenLM/Qwen) - 阿里云优秀的开源大语言模型（使用 Qwen3-14B）

## 📞 联系方式

- **Issues**: [GitHub Issues](https://github.com/yourusername/miaoji/issues)
- **Discussions**: [GitHub Discussions](https://github.com/yourusername/miaoji/discussions)

## 🗺 路线图

### v1.0.0 (MVP) - 2025 Q1
- [x] 技术方案设计
- [ ] Windows 服务端部署
- [ ] Web 前端应用
- [ ] 基础转写功能
- [ ] AI 总结功能
- [ ] 局域网访问

### v1.1.0 - 2025 Q2
- [ ] 高级编辑功能
- [ ] 音频同步播放
- [ ] 批量处理
- [ ] 多种导出格式
- [ ] WebSocket 实时推送

### v1.2.0 - 2025 Q3
- [ ] 说话人分离
- [ ] 实时转写（麦克风）
- [ ] 多用户管理
- [ ] 性能监控面板

### v2.0.0 (独立项目)
- [ ] 安卓移动端 App（第三方 API）
- [ ] iOS 移动端 App（可选）
- [ ] 云端备份（可选）

---

<div align="center">

**⭐ 如果这个项目对你有帮助，请给它一个星标！**

Made with ❤️ using Web + AI

**服务端**: Windows + GPU | **客户端**: 任何浏览器

</div>

