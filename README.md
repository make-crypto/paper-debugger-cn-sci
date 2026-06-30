# Paper Debugger CN SCI

一个面向 Overleaf 的中文论文到 SCI 英文写作助手原型。

这个项目受到 PaperDebugger 的启发，但当前第一版重点放在一个更具体的工作流上：在 Overleaf 中选中中文论文段落，由本地后端调用大模型，返回 SCI 风格英文译文、原文问题和修改说明。

## 当前版本

`v0.1.0`

第一版已经支持：

- 在 Overleaf 项目页面显示右侧中文助手面板
- 读取编辑器中选中的论文段落
- 通过本地 FastAPI 后端调用模型
- 支持 OpenAI Responses API 兼容接口
- 可通过 CC Switch 路由到 DeepSeek 等供应商
- 返回原文问题、SCI 英文译文和修改说明
- 在面板中编辑、保存和恢复默认提示词
- 复制 SCI 英文译文

## 项目结构

```text
paper-debugger-mvp/
  backend/
    main.py
    requirements.txt
    .env.example
  extension/
    manifest.json
    content.js
    panel.css
  README.md
```

## 运行后端

进入后端目录并安装依赖：

```powershell
cd backend
python -m pip install -r requirements.txt
```

复制配置文件：

```powershell
copy .env.example .env
```

如果使用 CC Switch，可以配置为：

```text
OPENAI_BASE_URL=http://127.0.0.1:15721/v1
OPENAI_API_KEY=cc-switch
OPENAI_MODEL=your-routed-model
```

如果直接使用 OpenAI API，可以删除 `OPENAI_BASE_URL`，并填写真实 API key：

```text
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4.1
```

启动后端：

```powershell
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

健康检查地址：

```text
http://127.0.0.1:8000/health
```

## 加载 Chrome 扩展

1. 打开 `chrome://extensions`
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择项目中的 `extension` 文件夹
5. 打开任意 Overleaf 项目
6. 在编辑器中选中文本，点击面板中的“翻译选中文本”

## 使用方式

1. 在 Overleaf 编辑器中选中一段中文论文内容。
2. 点击右侧面板的“翻译选中文本”。
3. 查看“原文问题”“SCI 英文译文”“修改说明”。
4. 需要时点击“复制 SCI 英文”，再手动粘贴回 Overleaf。

当前版本默认采用“安全复制”方式，不会自动覆盖 Overleaf 原文。

## 下一步计划

- 增加 AI 评分面板
- 增加是否需要引用的判断
- 增加中英对照显示
- 增加 LaTeX diff 和安全插入流程
- 后续接入 arXiv、Semantic Scholar、Crossref 等文献检索能力

## 安全说明

- 不要提交 `backend/.env`
- 不要把真实 API key 上传到 GitHub
- 当前插件只在 Overleaf 页面运行
- AI 结果需要人工确认后再用于论文正文
