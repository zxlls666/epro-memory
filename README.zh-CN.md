**中文** | [English](README.md)

# epro-memory

基于 LLM 的 Agent 记忆插件，支持 6 类记忆分类和 L0/L1/L2 三层结构。使用 [LanceDB](https://lancedb.com/) 作为向量存储，兼容 OpenAI API 进行抽取和嵌入。

## 特性

- **6 类记忆分类**：profile、preferences、entities、events、cases、patterns
- **L0/L1/L2 三层结构**：一句话摘要 (L0)、结构化概要 (L1)、完整叙述 (L2)
- **自动记忆抽取**：LLM 驱动，从 Agent 对话中自动提取记忆
- **向量去重**：嵌入相似度检索 + LLM 去重决策 (CREATE / MERGE / SKIP)
- **智能召回**：向量搜索 + 可配置相关性阈值，作为上下文注入
- **分类感知合并**：profile 始终合并；preferences、entities、patterns 支持合并；events、cases 仅追加

## 快速开始

### 安装

```bash
pnpm add @moltbot/epro-memory
```

### 配置

插件需要两个 API 密钥 — 一个用于嵌入，一个用于 LLM 抽取：

```json
{
  "embedding": {
    "apiKey": "${OPENAI_API_KEY}",
    "model": "text-embedding-3-small"
  },
  "llm": {
    "apiKey": "${OPENAI_API_KEY}",
    "model": "gpt-4o-mini"
  }
}
```

> **重要：** 切勿硬编码 API 密钥。请使用环境变量或密钥管理工具。详见 [SECURITY.md](SECURITY.md)。

### 配置项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `embedding.apiKey` | string | *必填* | 嵌入服务 API 密钥 |
| `embedding.model` | string | `text-embedding-3-small` | 嵌入模型 |
| `embedding.baseUrl` | string | — | 自定义 API 端点（非 OpenAI 提供商） |
| `llm.apiKey` | string | *必填* | LLM 抽取 API 密钥 |
| `llm.model` | string | `gpt-4o-mini` | LLM 模型 |
| `llm.baseUrl` | string | — | 自定义 API 端点 |
| `dbPath` | string | `~/.clawdbot/memory/epro-lancedb` | LanceDB 存储路径 |
| `autoCapture` | boolean | `true` | 自动从对话中抽取记忆 |
| `autoRecall` | boolean | `true` | 自动注入相关记忆作为上下文 |
| `recallLimit` | number | `5` | 每次查询最大召回数 |
| `recallMinScore` | number | `0.3` | 召回最低相似度 |
| `extractMinMessages` | number | `4` | 触发抽取的最少对话消息数 |
| `extractMaxChars` | number | `8000` | 处理的最大对话字符数 |

## 架构

### 记忆分类

| 分类 | 类型 | 合并行为 | 说明 |
|------|------|----------|------|
| `profile` | 用户 | 始终合并 | 用户身份与静态属性 |
| `preferences` | 用户 | 按主题合并 | 用户倾向、习惯和偏好 |
| `entities` | 用户 | 支持合并 | 项目、人物、组织 |
| `events` | 用户 | 仅追加 | 决策、里程碑、发生的事件 |
| `cases` | Agent | 仅追加 | 问题 + 解决方案 |
| `patterns` | Agent | 支持合并 | 可复用的流程和方法 |

### 抽取流程

```
对话 → LLM 抽取 → 候选记忆
    → 向量相似度检索 → 去重决策 (CREATE/MERGE/SKIP)
    → 持久化到 LanceDB
```

### 召回流程

```
用户输入 → 嵌入 → 向量搜索 → 相似度过滤
    → 按分类分组 → 作为 <agent-experience> 上下文注入
```

## 开发

### 前置要求

- Node.js 20+
- pnpm

### 构建

```bash
pnpm install
pnpm build
```

### 测试

```bash
# 单元测试
pnpm test

# 集成测试（需要 LanceDB）
pnpm test:integration

# 全部测试
pnpm test:all
```

## 技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| 向量存储 | [LanceDB](https://lancedb.com/) | 嵌入式、无服务器、无需外部数据库进程 |
| 配置校验 | [TypeBox](https://github.com/sinclairzx81/typebox) | 兼容 JSON Schema 的运行时类型安全校验 |
| 嵌入 & LLM | OpenAI 兼容 API | 通过 `baseUrl` 覆盖支持多家提供商 |
| 记忆分类 | 6 类系统 | 平衡粒度与合并语义 — 移植自 [OpenViking](https://github.com/toby-bridges/OpenViking) |
| 分层结构 | L0 / L1 / L2 | 按需注入：召回用一句话，深度查看用完整叙述 |
| 去重策略 | 向量预过滤 + LLM 决策 | 消除重复的同时不丢失语义细节 |

## 测试

106 个单元测试，覆盖 7 个测试套件。集成测试单独运行，对接真实 LanceDB 实例。

| 套件 | 测试数 | 覆盖范围 |
|------|--------|----------|
| config | 23 | Schema 校验、类型转换、范围检查、默认值 |
| validators | 19 | UUID 格式、分类白名单、SQL 注入拒绝 |
| llm-parser | 22 | LLM 响应中的 JSON 提取、边界情况 |
| conversation | 17 | 消息提取、截断、内容块格式 |
| extractor | 13 | 记忆抽取流程、候选解析 |
| deduplicator | 12 | 向量去重、合并决策、分类感知逻辑 |
| db.integration | 7 | LanceDB CRUD、向量搜索、并发写入（CI 中跳过） |

## 致敬

6 类记忆分类体系、L0/L1/L2 三层结构以及提示词模板（抽取、去重、合并）均移植自 [OpenViking](https://github.com/toby-bridges/OpenViking) 项目 — 一个支持持久化记忆的开源 LLM Agent 框架。

## 许可证

[Apache License 2.0](LICENSE)
