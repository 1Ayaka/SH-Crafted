# 探物志 非遗投稿 JSON 标准

版本：`sh-crafted.heritage-submission/v1`

该格式用于“添加文化遗产”页面的导入。页面支持 `.json` 和单条 `.jsonl` 文件。导入后内容仍处于待提交状态，投稿人必须检查并手动提交审核。

## 最小要求

- `title`：非遗名称，至少 2 个字符。
- `summary`：内容简介，至少 10 个字符。
- `overview_images`：至少 1 项。
- 每个 `overview_images` 项必须同时包含图片地址和 `description` 图片说明。
- 图片地址可以是公开的 `https://` 地址，也可以是 `data:image/...;base64,...`；页面拖放上传会自动生成后者。

## 完整示例

```json
{
  "schema": "sh-crafted.heritage-submission/v1",
  "title": "嘉定竹刻",
  "category": "传统技艺",
  "summary": "以竹材为载体，通过刻、磨、嵌等工序呈现书画与纹样的传统技艺。",
  "history": "填写历史沿革、传承脉络和流传地区。",
  "features": "填写形制、用途、地域特色和当代价值。",
  "source_url": "https://example.org/source",
  "cover_url": "https://example.org/cover.jpg",
  "gallery_urls": ["https://example.org/detail-1.jpg"],
  "overview_images": [
    {
      "title": "竹刻作品正面",
      "image_url": "https://example.org/overview.jpg",
      "description": "展示竹刻作品的正面构图与主要刻纹，用于星图节点概览。"
    }
  ],
  "star_data": {
    "summary": "该项目与嘉定地区、竹刻传统和竹材知识相关。",
    "relations": ["嘉定区", "竹刻传统", "竹材"],
    "keywords": ["竹刻", "传统技艺", "嘉定"],
    "images": [{ "title": "节点细节", "image_url": "https://example.org/detail.jpg", "description": "节点图片说明", "source_url": "https://example.org/source" }]
  },
  "steps": [
    {
      "name": "选竹与制坯",
      "description": "选择竹材并处理为适合雕刻的坯体。",
      "result": "获得平整、干燥的竹刻坯体。",
      "materials": ["竹材"],
      "tools": ["刨刀"],
      "actions": ["检查竹材", "制坯"],
      "documentary_clips": [{ "title": "选竹与制坯片段", "video_url": "assets/video/clip.mp4", "start_seconds": 0, "end_seconds": 30, "description": "展示本工序的纪录片片段。", "source_url": "https://example.org/source" }]
    }
  ],
  "contributor_name": "投稿人姓名",
  "contributor_contact": "联系邮箱或电话"
}
```

## 星图资料字段

`star_data` 是可选的星图补充信息：

- `summary`：星图侧栏显示的关联摘要。
- `relations`：关联的地区、传统或材料名称数组。
- `keywords`：用于检索和后续知识图谱整理的关键词数组。
- `images`：该节点可浏览的图片数组；每项支持 `title`、`image_url`、`description`、`source_url`。关联节点也可在各 `relations` 项内填写同名 `images`。

## 工序纪录片片段

每道工序可选填 `documentary_clips` 数组。填写有效 `video_url` 后，用户工作台会直接在桌面右侧显示播放器；未填写时不占用右侧空间。支持 `start_seconds`、`end_seconds` 控制片段区间。

`overview_images` 是星图概览图片，不建议只填写 `gallery_urls`。每张图片都需要清晰的 `description`，审核员会据此判断图片是否适合作为节点概览图。

## JSONL

JSONL 每行一个 JSON 对象。用户投稿页面一次导入一条记录；批量文件请拆分后逐条导入。

```jsonl
{"schema":"sh-crafted.heritage-submission/v1","title":"项目一","summary":"项目一简介至少十个字符。","overview_images":[{"image_url":"https://example.org/a.jpg","description":"项目一概览图说明"}]}
```

## 图片建议

- 推荐 JPG、PNG 或 WebP，单张不超过 2MB。
- 页面最多保留 8 张概览图，总大小建议控制在 6MB 以内。
- 首张图片会优先作为项目封面和星图概览图使用。

## 管理员主非遗导入

### 两个入口是否同一标准

是：两边使用同一个基础标准和字段名。用户入口会把记录写入待审核投稿；管理员入口会把同样结构作为已审核的正式主非遗新增到 `content.json`。因此同一份用户 JSON 可以被管理员再次导入，管理员只需补充或确认 `model_path`、稳定 `id` 等扩展字段。

管理员首页另有“导入主非遗 JSON”。该入口用于创建与原有 8 个主非遗同级的正式项目，不经过社区待审核队列；使用前应确认内容已经完成审核。

用户和管理员现在共用同一个基础格式标识：`sh-crafted.heritage-submission/v1`。管理员导入是在这个标准上的可信内容扩展，增加：

- `id`：可选的稳定 ID；留空时由服务端生成。
- `model_path`：模型 URL 或站点内路径，例如 `assets/models/crafts/example.glb`。
- `graph_data`：正式星图摘要、关键词和关联节点。

管理员默认只新增项目。修复旧的管理员导入条目时，可使用相同稳定 `id` 并设置 `update_existing: true`。更新受以下保护：

- `SHIH_0001` 至 `SHIH_0008` 原始主非遗永远不能通过 JSON 覆盖。
- 社区投稿或其他来源项目不能通过管理员 JSON 覆盖。
- 旧版批次只有在仍保留原脚本特征、没有工序且未被人工编辑时才允许更新。
- 新版管理员导入项目一旦在编辑页修改标题、简介、星图或工序，后续 JSON 更新会被拒绝。
- 更新仍携带当前内容 `revision`；协作者刚保存了新内容时，旧页面的导入会返回冲突，不会覆盖新版本。

```json
{
  "schema": "sh-crafted.heritage-submission/v1",
  "id": "new-primary-heritage",
  "update_existing": true,
  "title": "新主非遗项目",
  "district_id": "jiading",
  "category": "传统技艺",
  "summary": "已经审核完成的项目简介，至少十个字符。",
  "cover_url": "https://example.org/cover.jpg",
  "model_path": "assets/models/crafts/new-project.glb",
  "overview_images": [
    {
      "title": "项目概览",
      "image_url": "https://example.org/overview.jpg",
      "description": "用于星图总览和项目概览的图片说明。"
    }
  ],
  "graph_data": {
    "summary": "该项目与某地区、某传统和某材料相关。",
    "keywords": ["传统技艺", "地域文化"],
    "relations": [
      { "type": "tradition", "title": "相关传统", "summary": "关联传统说明" },
      { "type": "material", "title": "主要材料", "summary": "关联材料说明" }
    ]
  }
}
```
