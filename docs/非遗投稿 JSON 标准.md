# 探物志非遗投稿 JSON 标准

版本：`sh-crafted.heritage-submission/v1`

用户投稿和管理员批量导入使用同一套基础字段。用户导入后仍需手动提交审核；管理员导入会直接写入正式内容。

## 最小要求

- `title`：项目名称，至少 2 个字符。
- `district_id`：上海行政区 ID。
- `summary`：事实性简介，至少 10 个字符。
- `cover_url`：唯一主图，必填。支持公开 `https://` 图片、站内 `/content-uploads/...` 地址或 `data:image/...`。
- `images`：其他图片，选填；每项支持 `title`、`image_url`、`description`、`source_url`。

## 示例

```json
{
  "schema": "sh-crafted.heritage-submission/v1",
  "title": "嘉定竹刻",
  "district_id": "jiading",
  "category": "传统美术",
  "summary": "嘉定竹刻以竹材为载体，通过浅刻、深刻、透雕等方法表现书画和纹样。",
  "history": "",
  "features": "创作会根据竹材形态安排构图，刀法、层次和留地共同形成画面。",
  "source_url": "https://example.org/source",
  "cover_url": "https://example.org/cover.jpg",
  "images": [
    {
      "title": "竹刻作品细节",
      "image_url": "https://example.org/detail.jpg",
      "description": "展示刀痕、层次和竹材表面。",
      "source_url": "https://example.org/source"
    }
  ],
  "steps": [
    {
      "name": "选竹与制坯",
      "description": "选择竹材并处理为适合雕刻的坯体。",
      "result": "获得平整、干燥的竹刻坯体。",
      "materials": ["竹材"],
      "tools": ["刨刀"],
      "actions": ["检查竹材", "制坯"]
    }
  ]
}
```

## 图片规则

- 主图只维护一张，地图列表、项目详情和知识星图均使用它。
- `images` 用于补充不同角度、工艺细节或活动现场；详情页和星图共用，不再分别维护“概览图”和“节点图”。
- 页面支持 PNG、JPG、WebP、GIF，单张不超过 6MB。
- 旧字段 `overview_images`、`gallery_urls`、`star_data.images` 和 `graph_data.images` 仍可导入；服务端会合并、去重为 `images`。新文件不要再使用这些字段。

## 星图资料

管理员文件可提供：

```json
{
  "graph_data": {
    "summary": "项目在知识星图中的事实性摘要。",
    "keywords": ["竹刻", "嘉定", "竹材"],
    "relations": [
      { "type": "tradition", "title": "竹刻传统", "summary": "说明项目与该传统的关系。" },
      { "type": "material", "title": "竹材", "summary": "说明竹材在项目中的用途。" }
    ]
  }
}
```

地区关系不用填写，服务端根据 `district_id` 自动生成。关系节点不再拥有独立图片。

## 批量导入与同名覆盖

- 后台可一次选择多个 JSON、JSONL 文件，也可导入 JSON 数组。
- `id` 相同，或同一地区内归一化后名称相同的记录，可在 `update_existing: true` 时覆盖原导入项目。
- 名称匹配会忽略全角/半角差异、空格、连接符和中英文括号。
- 原始 `SHIH_0001` 至 `SHIH_0008`、社区项目和其他受保护来源不能通过管理员 JSON 覆盖。
- 已在后台手工维护的管理员导入项目仍拒绝自动覆盖，应在编辑页人工合并。
- 所有写入都使用内容 revision；发生并发更新时返回冲突，不会静默覆盖。

## JSONL

JSONL 每行一个 JSON 对象。用户页面一次只导入一条；管理员后台支持整批导入。

```jsonl
{"schema":"sh-crafted.heritage-submission/v1","title":"项目一","district_id":"jiading","summary":"项目一简介至少十个字符。","cover_url":"https://example.org/a.jpg","images":[]}
```
