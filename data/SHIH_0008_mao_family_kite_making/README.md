# 毛氏风筝智能体知识包

- 视频 ID：`SHIH_0008`
- 数据状态：候选知识，尚未完成人工审核
- 时间单位：毫秒
- 路径基准：本文件所在目录

## 目录

```text
manifest.json                 数据包与视频播放配置
agent_config.json             智能体检索和跳转配置
source/provider_output.json   火山引擎原始结构化输出
knowledge/knowledge_draft.json
knowledge/evidence.jsonl
knowledge/claims.jsonl
knowledge/process_steps.jsonl
media/frame_bindings.json
media/keyframes/*.jpg
```

## 智能体使用规则

1. 检索 `knowledge/evidence.jsonl`。
2. 回答必须返回 `evidence_id`、`start_ms`、`end_ms` 和引文。
3. 播放器从 `(start_ms - 3000) / 1000` 秒开始播放。
4. `vod_vid` 或 `playback_url` 需在 `manifest.json` 中补录。
5. 正式上线只使用 `review_status == verified` 的主张；当前数据均为候选。
