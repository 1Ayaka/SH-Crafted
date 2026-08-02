# 火山引擎视频知识包标准流程

1. 将火山引擎输出保存为合法 JSON 或仅包含 JSON 的 Markdown 文件。
2. 将源视频和输出文件路径添加到 `configs/knowledge_jobs.json`，分配永久 `video_id`。
3. 可选：在 `confirmed_terms` 中添加用户已确认的同音词规范映射。
4. 执行：`python scripts/build_agent_packages.py --config configs/knowledge_jobs.json`。
5. 脚本校验时间码、生成全局 ID、规范化候选、按证据时间抽帧，并生成相对路径。
6. 在每个包的 `manifest.json` 和 `agent_config.json` 补录 `vod_vid` 或 `playback_url`。
7. 人工审核后将正式知识改为 `verified`；生产智能体只加载已审核数据。

数据包目录可整体复制，不依赖当前工作区的绝对路径。源视频不进入数据包，以避免迁移包过大。
