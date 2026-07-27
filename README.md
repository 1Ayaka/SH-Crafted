# SH-Crafted v1

上海非物质文化遗产交互体验的第一个正式版本。项目包含上海非遗地图探索、四门工艺的资料与交互工作台、数据护照，以及“小蕉”辅助问答。

本项目不依赖前端 CDN，也没有 npm 运行时依赖。Three.js r160、模型、图片与数据均已随仓库提供，可离线运行。可选的 DeepSeek 问答通过 Node 服务端代理，密钥不会发送给浏览器。

## 环境要求

- Node.js 22 或更高版本（生产环境推荐 Node.js 24 LTS）
- 推荐使用最新版 Chrome、Edge、Firefox 或 Safari，并启用 WebGL

## 本地运行

```bash
npm start
```

默认监听 `0.0.0.0:7100`，浏览器打开 <http://localhost:7100/>。

也可以指定监听地址和端口：

```bash
npm start -- --host 127.0.0.1 --port 8080
```

或使用环境变量 `HOST`、`PORT`。页面使用 ES Module、Fetch 和 import map，必须通过 HTTP 服务访问，不能直接以 `file://` 打开 `index.html`。

## 配置问答服务

问答密钥是可选配置。未配置或上游服务不可用时，前端会自动切换到基于项目资料的本地检索式应答。

1. 复制 `.env.example` 为 `.env`。
2. 写入 `DEEPSEEK_API_KEY=你的密钥`。
3. 重启服务。

生产环境建议直接设置进程环境变量 `DEEPSEEK_API_KEY`。不要提交 `.env`；它已被 `.gitignore` 排除。服务端仅通过 `POST /api/agent` 使用密钥。

## 项目结构

```text
assets/      分层背景、纹样、上海地图及工艺 GLB 模型
css/         页面样式
data/        四个非遗项目的数据包、知识与关键帧
docs/        背景分层、转场和三维呈现说明
js/          路由、视图、交互、粒子与三维渲染
tools/       背景图层生成工具
vendor/      固定版本的 Three.js 及所需加载器
index.html   应用入口
server.mjs   静态文件服务与可选问答代理
deploy/      Nginx 与 systemd 部署模板
scripts/     服务器更新脚本
```

## 路由

| 地址 | 内容 |
| --- | --- |
| `#/` | 首页与水墨交互入口 |
| `#/explore` | 上海地图、搜索及分类探索 |
| `#/craft/<id>` | 工艺详情与交互工作台 |
| `#/passport` | 数据来源、授权与审核状态 |

现有工艺编号为 `SHIH_0001` 至 `SHIH_0004`，分别对应嘉定竹刻、南桥撕纸、药斑布和象牙篾丝编织。

## 服务器部署与更新

仓库可直接由 Node 运行，无需前端构建。推荐使用 systemd 保持 Node 进程运行，并由 Nginx 反向代理和终止 HTTPS。完整的首次部署、域名、证书和自动更新说明见 [`DEPLOYMENT.md`](DEPLOYMENT.md)。

部署前可运行 `npm run check`。服务器已完成首次配置后，执行 `bash scripts/deploy.sh` 即可拉取 `main`、校验并重启服务；也可启用仓库内的 GitHub Actions 工作流，让每次推送 `main` 自动部署。

## 数据与资源说明

`data/` 中的四个数据包包含 manifest、agent 配置、知识草稿、证据、工序和关键帧。当前资料的审核状态以数据文件为准，界面对自动生成或未审核内容保留“待审核”标识。

`tools/split_layers.py` 可重新生成背景分层资源；正式运行不需要 Python。完整的图层参数、组件接口和调试方法见 `docs/背景分层与转场系统.md`。
