// 八个工艺项目的扩展策展目录。数据只描述四类图谱实体和三种公开关系；
// 名称与地区归属来自政府/非遗官方名录，摘要为站内原创说明。

const SOURCES = Object.freeze({
  shanghaiFirst: {
    source_id: 'src_shgov_shanghai_ich_first',
    source_title: '第一批上海市非物质文化遗产名录',
    source_url: 'https://www.shanghai.gov.cn/nw17199/20210203/efdbfb831817480d96dfaccfa16d9156.html',
  },
  shanghaiSeventh: {
    source_id: 'src_shgov_shanghai_ich_seventh',
    source_title: '第七批上海市非物质文化遗产代表性项目名录',
    source_url: 'https://www.shanghai.gov.cn/nw12344/20240409/4da467e2f2f3495fa4380adfbe87636d.html',
  },
  jiading: {
    source_id: 'src_shgov_jiading_ich',
    source_title: '嘉定区非遗资料与第十三批区级名录',
    source_url: 'https://www.shanghai.gov.cn/gwk/search/content/2faf1cc9044e410b8c2664f794a04f02',
  },
  jiadingProfile: {
    source_id: 'src_shgov_jiading_profile',
    source_title: '嘉定区非遗专题',
    source_url: 'https://www.shanghai.gov.cn/jiading/index.html',
  },
  fengxian: {
    source_id: 'src_shgov_fengxian_profile',
    source_title: '奉贤区非遗专题',
    source_url: 'https://www.shanghai.gov.cn/fengxian/index.html',
  },
  minhang: {
    source_id: 'src_shgov_minhang_profile',
    source_title: '闵行区非遗专题',
    source_url: 'https://www.shanghai.gov.cn/minhang/index.html',
  },
  jingan: {
    source_id: 'src_jingan_ich_fifth',
    source_title: '静安区第五批区级非物质文化遗产代表性项目名录',
    source_url: 'https://www.jingan.gov.cn/BigFileUpLoadStorage/temp/2025-01-21/44ba7e45-8ec6-48b6-bffc-d214617be3d0/%E9%9D%99%E5%BA%9C%E5%8F%91%5B2025%5D1%E5%8F%B7.pdf',
  },
  chongming: {
    source_id: 'src_shgov_chongming_ich_catalog',
    source_title: '崇明岛非物质文化遗产项目名录',
    source_url: 'https://www.shanghai.gov.cn/cmsres/27/27d2c91c06aa4360bbedcb76d07b9e32/884f49ff94ef0a0dca6ef67f03eec182.pdf',
  },
  national: {
    source_id: 'src_ihchina_project_catalog',
    source_title: '中国非物质文化遗产网代表性项目名录',
    source_url: 'https://www.ihchina.cn/project.html',
  },
  projectKb: {
    source_id: 'src_shcrafted_project_kb',
    source_title: 'SH-Crafted 项目纪录片与工序知识包',
    source_url: '',
  },
});

const supportedMeta = (source) => ({
  authority_tier: source === SOURCES.national ? 'A' : 'B',
  review_status: 'supported',
  published: true,
});

const REGION_SETS = [
  ['jiading', '嘉定区', SOURCES.jiading, [
    ['jiading_taoist_music', '嘉定道教音乐'], ['nanxiang_xiaolong', '南翔小笼馒头制作技艺'],
    ['xuhang_grass_braid', '徐行草编'], ['malu_bamboo_weaving', '马陆篾竹编织技艺'],
    ['guxiu_jiading', '顾绣（嘉定）'], ['mianquan_jiading', '绵拳'], ['guqin_making_jiading', '古琴斫制技艺'],
    ['tea_art_jiading', '茶艺（嘉定）'], ['zheng_gynecology', '郑氏妇科疗法'], ['yujinxiang_wine', '郁金香酒酿造技艺'],
    ['refined_flower_tea', '精制花茶制作技艺'], ['xi_gynecology', '喜氏妇科疗法'],
    ['huang_anorectal', '黄氏肛肠疗法'], ['haipai_seal_knob', '海派印钮雕刻技艺'],
    ['haipai_jade_carving', '海派玉雕'], ['shanghai_story_singing', '上海说唱'],
    ['traditional_furniture_restoration', '传统家具修复制作技艺'], ['haipai_porcelain', '海派瓷艺'],
    ['chinese_candy_jiading', '中式糖果制作技艺'], ['zhuangyuan_rice_cake', '巧菱状元米糕制作技艺'],
    ['redwood_ornament_carving', '红木摆件雕刻技艺'],
  ]],
  ['fengxian', '奉贤区', SOURCES.fengxian, [
    ['jiangnan_sizhu_fengxian', '江南丝竹（奉贤）'], ['sun_family_erhu', '江南孙氏二胡艺术'],
    ['fengxian_rolling_lantern', '奉贤滚灯'], ['shadow_puppetry_fengxian', '皮影戏（奉贤）'],
    ['fengxian_folk_opera', '奉贤山歌剧'], ['baiyang_folk_song', '白杨村山歌'],
    ['fengxian_folk_paper_art', '奉贤乡土纸艺'], ['dingfeng_fermented_bean_curd', '鼎丰乳腐酿造工艺'],
    ['mutton_wine_custom', '羊肉烧酒食俗'], ['wood_carving_fengxian', '木雕（奉贤）'],
  ]],
  ['jingan', '静安区', SOURCES.jingan, [
    ['yue_opera_jingan', '越剧（静安）'], ['hengsheng_tailoring', '亨生奉帮裁缝缝纫技艺'],
    ['lvyangcun_cuisine', '绿杨村川扬菜点制作工艺'], ['kaiser_cake', '凯司令蛋糕制作技艺'],
    ['luan_ink_paste', '鲁庵印泥制作技艺'], ['hongxiang_womenswear', '鸿翔女装制作工艺'],
    ['wangjiasha_pastry', '王家沙本帮点心制作技艺'], ['longfeng_qipao', '龙凤旗袍制作技艺'],
    ['shikumen_construction', '石库门里弄建筑营造技艺'], ['ding_internal_medicine', '丁氏内科疗法'],
    ['yan_internal_medicine', '颜氏内科疗法'], ['haipai_seal_cutting', '海派篆刻'],
    ['chenpi_tea_scenting', '陈皮茶窨制作技艺'], ['cashmere_knitting', '羊绒服饰编结技艺'],
    ['shi_bone_setting', '施氏伤科'], ['du_surgery', '海派中医杜氏外科'],
    ['haipai_medicinal_diet', '海派药膳疗法'], ['cai_gynecology', '蔡氏妇科疗法'],
  ]],
  ['chongming', '崇明区', SOURCES.chongming, [
    ['yingzhou_pipa', '琵琶艺术（瀛洲古调派）'], ['jiangnan_sizhu_mudanting', '江南丝竹（牡丹亭）'],
    ['chongming_folk_song', '崇明山歌'], ['chongming_wind_percussion', '崇明吹打乐'],
    ['shoulder_pole_opera', '扁担戏'], ['yang_seyan_story', '杨瑟严的故事'], ['stove_flower_chongming', '灶花（崇明）'],
    ['yizhi_puzzle', '益智图'], ['lion_dance_chongming', '调狮子'], ['shanghai_rice_cake_chongming', '上海米糕制作技艺（崇明）'],
    ['chongming_proverbs', '崇明俗语'], ['sweet_baogua_pickles', '崇明甜包瓜制作技艺'],
    ['salted_alfalfa_pickles', '草头盐齑制作技艺'], ['bird_whistle_chongming', '鸟哨（崇明）'],
    ['chongming_old_baijiu', '崇明老白酒传统酿造技法'], ['chongming_narcissus', '崇明水仙栽培技艺'],
    ['chongming_jiuqu', '崇明酒曲制作技艺'], ['weather_proverbs_chongming', '天气谚语及其应用'],
    ['chongming_forge', '崇明洋钎'], ['chongming_mutton_cooking', '崇明羊肉传统烹饪技艺'],
    ['chongming_bamboo_weaving', '崇明竹编技艺'], ['chongming_qianhua_board', '崇明椠花板技艺'],
    ['boxwood_cultivation_chongming', '崇明瓜子黄杨树传统栽培技艺'], ['chongming_sand_ship', '崇明沙船制造技艺'],
    ['tape_weaving_chongming', '线带编织'], ['chongming_fish_ball', '崇明鱼圆烹饪技艺'],
    ['chongming_jiuban', '崇明酒粄传统酿造技艺'], ['chongming_round_cake', '崇明圆子传统制作技艺'],
    ['frog_button_chongming', '盘扣制作（崇明）'], ['bitter_grass_food_medicine', '崇明苦草药材食材制作技艺'],
  ]],
  ['minhang', '闵行区', SOURCES.minhang, [
    ['jiangnan_sizhu_minhang', '江南丝竹（闵行）'], ['shanghai_instrument_making', '上海民族乐器制作技艺'],
    ['maqiao_hand_lion', '马桥手狮舞'], ['shanghai_proverbs_minhang', '沪谚'],
    ['crochet_minhang', '钩针编织技艺'], ['shanghai_rice_cake_minhang', '上海米糕制作技艺（闵行）'],
    ['lacquer_kuancai', '漆器制作技艺（款彩、揩漆）'], ['painting_mounting_minhang', '书画装裱修复技艺'],
    ['ancient_ship_model', '古船模型制作技艺'], ['sachet_minhang', '香囊制作技艺'],
    ['gourd_printing_minhang', '套板葫芦'], ['haipai_flower_arrangement', '海派插花'],
    ['old_wood_restoration', '古旧木器修缮'], ['huacao_gongs', '华漕小锣鼓'],
    ['carp_dragon_gate', '鲤鱼跳龙门'],
  ]],
];

const TRADITION_SETS = [
  ['tradition:paper_art', '纸艺传统', SOURCES.national, [
    ['yangzhou_paper_cutting', '扬州剪纸'], ['yuxian_paper_cutting', '蔚县剪纸'],
    ['yueqing_fine_paper_cutting', '乐清细纹刻纸'], ['guangdong_paper_cutting', '广东剪纸'],
    ['dai_paper_cutting', '傣族剪纸'], ['shanghai_paper_cutting', '上海剪纸'], ['hebei_paper_cutting', '河北剪纸'],
  ]],
  ['tradition:kite_making', '风筝制扎技艺', SOURCES.national, [
    ['weifang_kite', '潍坊风筝'], ['beijing_kite_ha', '北京风筝哈制作技艺'],
    ['nantong_banyao_kite', '南通板鹞风筝'], ['tianjin_kite_wei', '天津风筝魏制作技艺'],
    ['lhasa_kite', '拉萨风筝'], ['uyghur_kite', '维吾尔族风筝制作技艺'], ['cao_family_kite', '曹氏风筝工艺'],
  ]],
  ['tradition:chinese_shadow_puppetry', '中国皮影戏', SOURCES.national, [
    ['huaxian_shadow', '华县皮影戏'], ['hejian_shadow', '河间皮影戏'], ['xiaoyi_shadow', '孝义皮影戏'],
    ['haining_shadow', '海宁皮影戏'], ['lufeng_shadow', '陆丰皮影戏'], ['fuzhou_shadow', '复州皮影戏'],
  ]],
  ['tradition:shanghai_new_year_picture', '年画传统', SOURCES.national, [
    ['yangliuqing_new_year_picture', '杨柳青年画'], ['taohuawu_new_year_picture', '桃花坞木版年画'],
    ['mianzhu_new_year_picture', '绵竹木版年画'], ['yangjiabu_new_year_picture', '杨家埠木版年画'],
    ['zhuxianzhen_new_year_picture', '朱仙镇木版年画'], ['zhangzhou_new_year_picture', '漳州木版年画'],
  ]],
  ['tradition:ivory_carving', '牙雕与篾丝编织传统', SOURCES.national, [
    ['beijing_ivory_carving', '北京象牙雕刻'], ['guangzhou_ivory_carving', '广州象牙雕刻'],
    ['changzhou_ivory_micro_carving', '常州象牙浅刻'], ['ningbo_bone_wood_inlay', '宁波骨木镶嵌'],
    ['guangzhou_bone_carving', '广州骨雕'], ['beijing_bone_carving', '北京骨雕'],
  ]],
];

const MATERIAL_SETS = [
  ['material:paperboard', '纸张', SOURCES.shanghaiFirst, [
    ['duoyunxuan_woodblock', '朵云轩木版水印技艺'], ['comic_strip_art', '连环画'],
    ['foam_paper_print', '吹塑纸版画'], ['luodian_lantern', '罗店彩灯'],
  ]],
  ['material:bamboo', '竹材', SOURCES.national, [
    ['dongyang_bamboo_weaving', '东阳竹编'], ['qingshen_bamboo_weaving', '青神竹编'],
    ['porcelain_bamboo_weaving', '瓷胎竹编'], ['huangyan_bamboo_carving', '黄岩翻簧竹雕'],
  ]],
];

function regionalNode(districtId, districtLabel, source, [slug, title]) {
  return {
    id: `heritage:regional_${slug}`,
    type: 'heritage',
    title,
    aliases: [],
    district_id: districtId,
    summary: `${title}见于官方非遗名录或${districtLabel}公开资料。当前星图据此展示其地区归属，其他关系仅在获得直接证据后开放。`,
    source_ids: [source.source_id],
    ...supportedMeta(source),
    ...source,
  };
}

function relatedNode(targetId, relationLabel, source, [slug, title]) {
  return {
    id: `heritage:related_${slug}`,
    type: 'heritage',
    title,
    aliases: [],
    summary: `${title}见于官方非遗资料，作为${relationLabel}下的可浏览项目接入；详细差异仍以来源原文和后续人工审核为准。`,
    source_ids: [source.source_id],
    ...supportedMeta(source),
    ...source,
    graph_target_id: targetId,
  };
}

const regionalNodes = REGION_SETS.flatMap(([districtId, districtLabel, source, items]) =>
  items.map((item) => regionalNode(districtId, districtLabel, source, item)));
const traditionNodes = TRADITION_SETS.flatMap(([targetId, label, source, items]) =>
  items.map((item) => relatedNode(targetId, label, source, item)));
const materialNodes = MATERIAL_SETS.flatMap(([targetId, label, source, items]) =>
  items.map((item) => relatedNode(targetId, `${label}相关工艺`, source, item)));

export const CURATED_GRAPH_NODES = [
  {
    id: 'tradition:ivory_carving', type: 'tradition', title: '牙雕与篾丝编织传统', aliases: ['牙雕', '象牙篾丝'],
    summary: '该节点仅用于历史工艺与博物馆保护语境。现行政策已停止商业性加工销售象牙及制品，星图不提供交易或购买引导。',
    source_ids: [SOURCES.national.source_id], ...SOURCES.national,
    ...supportedMeta(SOURCES.national),
  },
  ...regionalNodes,
  ...traditionNodes,
  ...materialNodes,
];

const relatedEdges = [
  ...TRADITION_SETS.flatMap(([targetId, , source, items]) => items.map(([slug]) => ({
    from: `heritage:related_${slug}`, relation: 'BELONGS_TO_TRADITION', to: targetId, ...supportedMeta(source), ...source,
  }))),
  ...MATERIAL_SETS.flatMap(([targetId, , source, items]) => items.map(([slug]) => ({
    from: `heritage:related_${slug}`, relation: 'USES_MATERIAL', to: targetId, ...supportedMeta(source), ...source,
  }))),
];

export const CURATED_GRAPH_EDGES = [
  ...relatedEdges,
  { from: 'heritage:SHIH_0004', relation: 'BELONGS_TO_TRADITION', to: 'tradition:ivory_carving', ...supportedMeta(SOURCES.national), ...SOURCES.national },
  { from: 'heritage:SHIH_0003', relation: 'USES_MATERIAL', to: 'material:cotton', ...supportedMeta(SOURCES.projectKb), ...SOURCES.projectKb },
  { from: 'heritage:SHIH_0006', relation: 'USES_MATERIAL', to: 'material:paperboard', ...supportedMeta(SOURCES.projectKb), ...SOURCES.projectKb },
];

export const GRAPH_PROJECT_MINIMUMS = Object.freeze([
  'heritage:SHIH_0001', 'heritage:SHIH_0002', 'heritage:SHIH_0003', 'heritage:SHIH_0004',
  'heritage:SHIH_0005', 'heritage:SHIH_0006', 'heritage:SHIH_0007', 'heritage:SHIH_0008',
]);
