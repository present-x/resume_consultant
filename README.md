<p align="center">
  <img src="https://img.icons8.com/fluency/96/resume.png" alt="Logo" width="80" height="80">
</p>

<h1 align="center">大厂产研简历优化教练</h1>
<h3 align="center">AI Resume Consultant for Tech Positions</h3>

<p align="center">
  <strong>🎯 专为大厂产研岗位打造的 AI 简历优化工具</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#快速开始">快速开始</a> •
  <a href="#技术架构">技术架构</a> •
  <a href="#配置说明">配置说明</a> •
  <a href="#贡献指南">贡献指南</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Next.js-15-black?logo=next.js" alt="Next.js">
  <img src="https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi" alt="FastAPI">
  <img src="https://img.shields.io/badge/PostgreSQL-15-336791?logo=postgresql" alt="PostgreSQL">
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker" alt="Docker">
  <img src="https://img.shields.io/badge/License-MIT-green" alt="License">
</p>

---

## 📖 项目简介

**简历优化教练** 是一款基于大语言模型的 AI 简历分析与优化工具，专为互联网大厂产品、技术岗位求职者设计。

本项目源于 Dify 工作流实现，现已重构为独立的全栈 Web 应用，支持多种 LLM 供应商（DeepSeek、Kimi、Gemini），提供完整的简历五步审查工作流。

### 🎯 核心价值

- **专业视角**：以 FAANG 级别招聘官视角审视简历
- **深度分析**：5 步工作流全方位诊断简历问题
- **可操作建议**：提供"批判-解析-建议"三位一体反馈
- **实战导向**：生成可直接使用的优化版简历范本

---

## ✨ 功能特性

### 🔍 五步审查工作流

| 步骤 | 名称 | 说明 |
|------|------|------|
| 1️⃣ | **第一印象与初步诊断** | 30秒快速判断，目标定位评估 |
| 2️⃣ | **地毯式深度审计** | 整体审计 + 模块化审计 + "所以呢？"拷问法 |
| 3️⃣ | **战略性修改蓝图** | 影响力叙事工具箱 + 启发式提问引导 |
| 4️⃣ | **重构与展示** | 生成优化后的完整简历范本 |
| 5️⃣ | **最终裁决与行动清单** | 总结评价 + 具体行动项 |

### 🤖 多 LLM 支持

- **DeepSeek** - 性价比之选
- **Kimi (Moonshot)** - 长文本处理能力强
- **Gemini** - Google 最新大模型

### 🎨 现代化界面

- 响应式设计，支持桌面/移动端
- 实时流式输出，即时查看分析结果
- Markdown 渲染，格式清晰美观
- **简历存档**：自动保存上传的简历，无需重复上传
- **历史记录**：查看过往分析对话历史
- 简洁明亮 UI 设计

---

## 🚀 快速开始

### 方式一：Docker Compose（推荐）

```bash
# 1. 克隆项目
git clone https://github.com/your-username/resume-consultant.git
cd resume-consultant

# 2. 配置环境变量（可选）
export SECRET_KEY=your-secure-secret-key

# 3. 启动服务
docker-compose up -d

# 4. 访问应用
# 前端: http://localhost:3001
# 后端 API: http://localhost:8002
# API 文档: http://localhost:8002/docs
```

### 方式二：本地开发

#### 前置要求
- Node.js 20+
- Python 3.12+
- PostgreSQL 15+（可选：仅在你将数据库切换到 PostgreSQL 时需要）

#### 后端

```bash
cd backend

# 创建虚拟环境
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 配置环境变量
cp .env.example .env
# 默认使用 SQLite，无需修改；如需 PostgreSQL 再修改 DATABASE_URL

# 启动服务
# 启动服务 (端口 8002)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8002
```

> **注意**：本地开发默认使用 SQLite 数据库 (`resume_consultant.db`)，无需配置 PostgreSQL。
> 如需使用 PG，请修改 `.env` 中的 `DATABASE_URL`。

#### 前端

```bash
cd frontend

# 安装依赖
npm install

# 启动开发服务器
# 启动开发服务器 (端口 3001)
npm run dev
```

访问地址：
- 前端：http://localhost:3001
- 后端 API：http://localhost:8002
- API 文档：http://localhost:8002/docs

### 测试账号

| 邮箱 | 密码 |
|------|------|
| test@resume.ai | test123 |

---

## 🏗️ 技术架构

```
resume-consultant/
├── frontend/                 # Next.js 15 前端
│   ├── src/
│   │   ├── app/              # App Router 页面
│   │   │   ├── page.tsx      # 登录页
│   │   │   ├── chat/         # 对话分析页
│   │   │   └── admin/        # 模型配置页
│   │   ├── components/       # UI 组件
│   │   └── lib/              # 工具函数
│   └── Dockerfile
│
├── backend/                  # FastAPI 后端
│   ├── app/
│   │   ├── main.py           # 应用入口
│   │   ├── api/              # API 路由
│   │   ├── core/             # 配置、认证
│   │   ├── models/           # 数据库模型
│   │   ├── services/
│   │   │   ├── llm/          # LLM 供应商封装
│   │   │   └── workflow/     # 工作流引擎
│   │   └── prompts/          # Prompt 模板
│   └── Dockerfile
│
└── docker-compose.yml        # 容器编排
```

### 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Next.js 15, React 19, TypeScript, Tailwind CSS |
| 后端 | FastAPI, SQLAlchemy, Pydantic |
| 数据库 | PostgreSQL |
| LLM | DeepSeek / Kimi / Gemini API |
| 部署 | Docker Compose |

---

## ⚙️ 配置说明

### 环境变量

#### 后端 (.env)

```env
# 应用配置
DEBUG=false
SECRET_KEY=your-super-secret-key-change-in-production

# 数据库
DATABASE_URL=sqlite+aiosqlite:///./resume_consultant.db
# DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/resume_consultant

# CORS
CORS_ORIGINS=["http://localhost:3001"]

# 测试账号
TEST_USER_EMAIL=test@resume.ai
TEST_USER_PASSWORD=test123
```

#### 前端

```env
NEXT_PUBLIC_API_URL=http://localhost:8002
```

### LLM API 配置

登录后，进入「模型配置」页面添加 LLM 供应商：

1. 选择供应商（DeepSeek / Kimi / Gemini）
2. 填写 API Key
3. 选择模型名称
4. 设为默认

---

## 🤝 贡献指南

欢迎提交 Issue 和 Pull Request！

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 📄 License

本项目采用 [MIT License](LICENSE) 开源协议。

---

## 🙏 致谢

- [Dify](https://dify.ai) - 原始工作流实现平台
- [SQLBot](https://github.com/dataease/SQLBot) - README 格式参考
- 所有 LLM 供应商的 API 支持

---

<p align="center">
  <strong>⭐ 如果这个项目对你有帮助，请给一个 Star！</strong>
</p>
