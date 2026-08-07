# 图谱研究交付规范（所有研究子代理必读）

你在为“探物志”上海非遗交互数字平台建立“三维非遗知识图谱”的**研究数据**。最终成果是图谱种子数据，规范来源：`docs/三维非遗知识图谱实施方案.md`（可先读第 3、6、7 节）。

## 铁律

1. **不得虚构**：每个节点、关系、事实必须有真实来源支撑，来源必须是你通过 WebSearch / FetchURL 实际检索到、且 URL 真实存在的页面。宁可数量少，不得编造项目名或名录信息。
2. **每个分支 5—10 项为目标，不足时提交真实数量**（实施方案 6.8/7.x 明确禁止凑数）。
3. 摘要必须**原创改写**（80—200 字），不得复制网页长段落。
4. 来源优先级：A=国家/国际名录、法律法规、政府公报、UNESCO；B=省市区政府、文化主管部门、官方保护单位、权威学术出版；C=博物馆、官方文旅平台、主流媒体专题。D 级（自媒体等）不得使用。
5. 优先使用这些站点：`www.ihchina.cn`（中国非物质文化遗产网）、`ich.unesco.org`、`www.shanghai.gov.cn`、各区政府网、`www.chnmuseum.cn` 等。
6. 输出**只有已核验内容**：`review_status` 一律写 `"verified"`，`authority_tier` 按来源实际等级写 A/B/C。拿不准的内容直接不要写进来。
7. 涉及象牙等受监管材料时，必须附现行法律语境（2017 年起中国全面停止商业性加工销售象牙及制品），不得提供交易/购买引导。

## ID 规范

小写英文字母、数字、下划线：

- `heritage_<地区或机构>_<英文短名>`，如 `heritage_qibao_shadow`、`heritage_tangshan_shadow`
- `region_<行政区划英文短名>`，如 `region_minhang`、`region_tangshan`
- `tradition_<英文短名>`，如 `tradition_chinese_shadow_puppetry`
- `material_<英文短名>`，如 `material_animal_hide`、`material_bamboo`
- `src_<机构>_<主题>_<年份或序号>`，如 `src_ihchina_tangshan_shadow`

## 输出格式

在你的任务目录下写出一个 JSON 文件（路径由任务指定），结构如下（JSONL 不要，单个 JSON）：

```json
{
  "cluster": "cluster_id",
  "nodes": [
    {
      "id": "heritage_qibao_shadow",
      "type": "heritage | region | tradition | material",
      "title": "七宝皮影戏",
      "aliases": ["七宝皮影"],
      "summary": "80—200字原创改写摘要。",
      "category": "传统戏剧/传统美术/传统技艺等（仅 heritage 必填；region 填行政层级如'市辖区'；tradition 可填体系类别；material 填材料分类如'动物皮革'）",
      "level": "国家级/市级/区级/人类非遗代表作名录 等（region/tradition/material 可填空串）",
      "image": null,
      "source_ids": ["src_xxx"],
      "authority_tier": "A"
    }
  ],
  "edges": [
    {
      "from": "heritage_qibao_shadow",
      "predicate": "LOCATED_IN | BELONGS_TO_TRADITION | USES_MATERIAL | USES_ALTERNATIVE_MATERIAL",
      "to": "region_minhang",
      "description": "说明这条关系的直接证据（一句话）。",
      "source_ids": ["src_xxx"],
      "authority_tier": "A",
      "display_priority": 80
    }
  ],
  "facts": [
    {
      "subject_id": "heritage_qibao_shadow",
      "statement": "一条可独立核验的事实陈述（一两句话）。",
      "source_ids": ["src_xxx"],
      "authority_tier": "A"
    }
  ],
  "sources": [
    {
      "source_id": "src_ihchina_tangshan_shadow",
      "title": "皮影戏（唐山皮影戏）",
      "publisher": "中国非物质文化遗产网",
      "url": "https://www.ihchina.cn/project_details/13392/",
      "source_type": "national_register | unesco | gov_notice | local_register | museum | media_feature | academic",
      "authority_tier": "A",
      "published_at": "",
      "checked_at": "2026-08-05",
      "license_note": "仅保存改写摘要与原文链接"
    }
  ]
}
```

## 每个 heritage 节点的最低交付

- 1 条 `LOCATED_IN`、1 条 `BELONGS_TO_TRADITION`、1—3 条 `USES_MATERIAL`（替代材料用 `USES_ALTERNATIVE_MATERIAL`）。
- 3—8 条独立事实（确实资料不足的冷门项目可 2—3 条，但每条必须有来源）。
- 80—200 字摘要。
- region / tradition / material 节点：摘要 + 2—5 条事实 + 至少 1 个来源。

## 图片（image 字段）

为尽量多的节点找**配图候选**，只接受 Wikimedia Commons（授权清晰）：

- 用 `https://commons.wikimedia.org/w/index.php?search=<关键词>&title=Special:MediaSearch&type=image` 或 Commons API 搜索，点开文件页确认授权为 CC-BY / CC-BY-SA / Public domain。
- `image` 字段填：
  ```json
  {
    "url": "https://upload.wikimedia.org/wikipedia/commons/thumb/<path>/640px-<filename>",
    "license": "CC BY-SA 4.0",
    "author": "作者名",
    "source_page": "https://commons.wikimedia.org/wiki/File:xxx.jpg"
  }
  ```
- 用 640px 左右的 thumb URL。找不到合适图片就 `null`，不要硬凑。
- 上海八个主项目（SHIH_0001—0008）不需要 image（前端用站内模型/关键帧），`image` 写 `null`。

## 八个主项目的固定 ID 与地区锚点（必须使用，不得另造）

| video_id | 图谱节点 ID | 名称 | LOCATED_IN |
| --- | --- | --- | --- |
| SHIH_0001 | `heritage_jiading_bamboo_carving` | 嘉定竹刻 | `region_jiading` |
| SHIH_0002 | `heritage_nanqiao_torn_paper` | 南桥撕纸 | `region_fengxian` |
| SHIH_0003 | `heritage_yaobanbu_cloth` | 药斑布 | `region_jiading` |
| SHIH_0004 | `heritage_ivory_filament_weaving` | 象牙篾丝编织 | `region_jingan` |
| SHIH_0005 | `heritage_chongming_handwoven_cloth` | 崇明土布纺织技艺 | `region_chongming` |
| SHIH_0006 | `heritage_shanghai_calendar_poster` | 上海月份牌年画 | `region_jingan` |
| SHIH_0007 | `heritage_qibao_shadow` | 七宝皮影戏 | `region_minhang` |
| SHIH_0008 | `heritage_mao_family_kite` | 毛氏风筝 | `region_fengxian` |

主项目的 `video_id` 用扩展字段 `"video_id": "SHIH_0007"` 写在节点里。

## 质量自查（提交前）

- JSON 能被解析（用 `node -e "JSON.parse(require('fs').readFileSync('<文件>','utf8'))"` 验证）。
- 所有 `source_ids` 引用都在本文件 `sources` 中有定义（引用其他簇共享来源时除外，但共享来源 ID 要在任务中给定）。
- 所有边的 from/to 都在本文件 nodes 中，或属于任务中声明的"外部已存在节点"。
- 没有重复 ID。
