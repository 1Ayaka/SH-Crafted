// 已核验的首批图谱补充数据。每条节点/关系都保留公开来源，后续可替换为
// 服务端 graph.json，而不改变前端渲染和状态层。
const MINHANG_SOURCE = {
  source_id: 'src_shgov_minhang_profile',
  source_title: '闵行区·上海市人民政府',
  source_url: 'https://www.shanghai.gov.cn/minhang/index.html',
};
const SHADOW_SOURCE = {
  source_id: 'src_ihchina_shadow_general',
  source_title: '中国皮影戏·中国非物质文化遗产网',
  source_url: 'https://www.ihchina.cn/news_1_details/11504.html',
};
const SHANGHAI_CATALOG_SOURCE = {
  source_id: 'src_shanghai_ich_extension_catalog',
  source_title: '上海市非物质文化遗产代表性项目名录扩展项目名录',
  source_url: 'https://www.shanghai.gov.cn/shanghai/download/gongkai/f2.pdf',
};
const INHERITOR_SOURCE = {
  source_id: 'src_shanghai_ich_inheritor_evaluation',
  source_title: '上海市2022—2024年度市级非物质文化遗产代表性传承人开展传承活动评估结果',
  source_url: 'https://whlyj.sh.gov.cn/cmsres/41/41e265a8d0624e178f7a935e94f6e0f7/f8d232fcac21ad8bd6376bbcdda99e0c.pdf',
};
const IVORY_POLICY_SOURCE = {
  source_id: 'src_gov_ivory_trade_ban',
  source_title: '国务院办公厅关于有序停止商业性加工销售象牙及制品活动的通知',
  source_url: 'https://www.mofcom.gov.cn/zcfb/zgdwjjmywg/art/2017/art_4be6156f14004b149141161a96ffa952.html',
};
const TANGSHAN_SHADOW_SOURCE = {
  source_id: 'src_ihchina_tangshan_shadow',
  source_title: '中国非物质文化遗产网：唐山皮影戏',
  source_url: 'https://www.ihchina.cn/project_details/13392/',
};

export const GRAPH_SEED_NODES = [
  {
    id: 'tradition:jiangnan_shadow', type: 'tradition', title: '江南皮影艺术',
    aliases: ['江南皮影'], summary: '七宝皮影戏被闵行区政府介绍为较早完整扎根上海的江南皮影艺术，并在长期演出传播中形成海派特点。',
    source_ids: [MINHANG_SOURCE.source_id], ...MINHANG_SOURCE,
  },
  {
    id: 'tradition:chinese_shadow_puppetry', type: 'tradition', title: '中国皮影戏',
    aliases: ['皮影戏'], summary: '皮影戏以雕刻、彩绘的兽皮或纸制影人配合灯光、影幕和表演完成叙事，各地因声腔、造型和表演方式形成地方流派。',
    source_ids: [SHADOW_SOURCE.source_id], ...SHADOW_SOURCE,
  },
  {
    id: 'tradition:traditional_folk_dance', type: 'tradition', title: '传统民间舞蹈',
    aliases: ['民间舞蹈'], summary: '马桥手狮舞源于狮子灯，将灯彩、杂技、武术与民俗结合，是闵行地方岁时节令舞蹈的代表。',
    source_ids: [MINHANG_SOURCE.source_id], ...MINHANG_SOURCE,
  },
  {
    id: 'tradition:jiangnan_music', type: 'tradition', title: '江南丝竹与民间音乐',
    aliases: ['江南丝竹'], summary: '江南丝竹产生于江、浙、沪一带，以丝竹乐器合奏、加花变奏和小细轻雅的风格见长。',
    source_ids: [MINHANG_SOURCE.source_id], ...MINHANG_SOURCE,
  },
  {
    id: 'tradition:traditional_bamboo_craft', type: 'tradition', title: '竹刻与竹编传统',
    aliases: ['竹工艺'], summary: '竹刻、竹编以竹材为主要媒介，分别发展出雕刻、编结和器物制作等地域性工艺实践。',
    source_ids: ['src_ihchina_jiading_bamboo', SHANGHAI_CATALOG_SOURCE.source_id],
    source_title: '中国非物质文化遗产网与上海市非遗名录',
    source_url: 'https://www.ihchina.cn/project_details/14031',
  },
  {
    id: 'tradition:traditional_textile', type: 'tradition', title: '传统手工纺织',
    aliases: ['土布纺织'], summary: '崇明土布、药斑布等项目连接了棉纤维、纺线、织造、染色与地方生活用品，是上海乡土纺织传统的不同实践。',
    source_ids: ['src_shgov_chongming_profile', 'src_sh_agri_textiles'],
    source_title: '崇明区·土布纺织技艺；沪郊土布的前世今生',
    source_url: 'https://www.shanghai.gov.cn/chongming/index.html',
  },
  {
    id: 'tradition:paper_art', type: 'tradition', title: '海派纸艺',
    aliases: ['撕纸', '剪纸'], summary: '南桥撕纸通过徒手撕纸、整形和粘贴形成画面，属于上海地方纸艺传承实践。',
    source_ids: ['src_fengxian_nanqiao_intro', 'src_fengxian_ich_catalog_2026'],
    source_title: '六月奉贤：南桥撕纸活动介绍；奉贤区非遗项目保护单位名单',
    source_url: 'https://www.fengxian.gov.cn/bmts/20250618/90911.html',
  },
  {
    id: 'tradition:traditional_food_craft', type: 'tradition', title: '传统食品制作技艺',
    aliases: ['传统食品技艺'], summary: '传统食品制作技艺把地方物产、季节习俗和家庭生活连接起来，崇明酱菜是上海名录中的地方项目。',
    source_ids: [SHANGHAI_CATALOG_SOURCE.source_id], ...SHANGHAI_CATALOG_SOURCE,
  },
  {
    id: 'tradition:shanghai_new_year_picture', type: 'tradition', title: '上海年画与月份牌传统',
    aliases: ['月份牌年画', '年画'], summary: '月份牌年画吸收西洋绘画技法并融合传统年画，形成具有上海城市文化特征的图像传统。',
    source_ids: ['src_ihchina_new_year_pictures', 'src_sh_culture_calendar_poster'],
    source_title: '中国非物质文化遗产网；上海市文化和旅游局',
    source_url: 'https://www.ihchina.cn/news_1_details/10351.html',
  },
  {
    id: 'tradition:kite_making', type: 'tradition', title: '风筝制扎技艺',
    aliases: ['风筝制作'], summary: '毛氏风筝制扎技艺以竹制骨架、裱糊和绘制为主要工序，并针对奉贤滨海风力形成地方经验。',
    source_ids: ['src_fengxian_mao_kite_history'],
    source_title: '奉贤区风筝制作技艺项目介绍',
    source_url: 'https://www.fengxian.gov.cn/wlj/whycbh/fwzwhyc/20150724/2302-4b912859-c8a3-4d99-b4af-a4bcb0cf08b7.html',
  },
  {
    id: 'material:animal_hide', type: 'material', title: '兽皮',
    aliases: ['皮革'], summary: '中国皮影戏使用经过处理、雕刻和彩绘的兽皮制作影人；不同地区会形成不同的造型和表演风格。',
    source_ids: [SHADOW_SOURCE.source_id], ...SHADOW_SOURCE,
  },
  {
    id: 'material:paperboard', type: 'material', title: '纸板与纸张',
    aliases: ['纸', '纸板'], summary: '中国非遗网对皮影的概述同时提到纸影形态；纸张也是上海剪纸、南桥撕纸等纸艺项目的基础材料。',
    source_ids: [SHADOW_SOURCE.source_id, 'src_fengxian_nanqiao_intro'],
    source_title: '中国皮影戏；六月奉贤：南桥撕纸活动介绍',
    source_url: 'https://www.ihchina.cn/news_1_details/11504.html',
  },
  {
    id: 'material:bamboo', type: 'material', title: '竹材',
    aliases: ['竹'], summary: '竹材连接嘉定竹刻、竹编、风筝骨架和多种传统器物制作；具体用途需以项目工序和来源记录为准。',
    source_ids: ['src_ihchina_jiading_bamboo', 'src_fengxian_mao_kite_history'],
    source_title: '竹刻（嘉定竹刻）；奉贤区风筝制作技艺项目介绍',
    source_url: 'https://www.ihchina.cn/project_details/14031',
  },
  {
    id: 'material:cotton', type: 'material', title: '棉纤维',
    aliases: ['棉花'], summary: '崇明土布纺织从棉花、纺线延伸到织造，棉纤维是其传统生活织物体系的重要起点。',
    source_ids: ['src_shgov_chongming_profile', 'src_sh_ethnic_chongming_cloth'],
    source_title: '崇明区·土布纺织技艺；崇明土布文化与传承实践',
    source_url: 'https://www.shanghai.gov.cn/chongming/index.html',
  },
  {
    id: 'material:ivory', type: 'material', title: '象牙（历史工艺语境）',
    aliases: ['象牙'], summary: '象牙篾丝编织属于历史工艺资料语境。现行政策已全面停止商业性加工销售象牙及制品，页面不提供购买或交易引导。',
    source_ids: ['src_gov_ivory_trade_ban', 'src_ihchina_ivory_weaving_demo'], ...IVORY_POLICY_SOURCE,
  },
  {
    id: 'heritage:tangshan_shadow', type: 'heritage', title: '唐山皮影戏',
    aliases: ['唐山皮影'],
    summary: '唐山皮影戏是第一批国家级非物质文化遗产代表性项目，常用牛皮、驴皮或羊皮制作影人，以白纸屏幕配合灯光表演，形成了具有地域特色的影戏风格。',
    district_id: 'tangshan', source_ids: [TANGSHAN_SHADOW_SOURCE.source_id], ...TANGSHAN_SHADOW_SOURCE,
  },
  {
    id: 'heritage:minhang_hand_lion_dance', type: 'heritage', title: '马桥手狮舞',
    aliases: ['手狮舞'], summary: '马桥手狮舞源于狮子灯，道具造型独特并由手工扎制，融合灯彩、杂技、武术和民俗。',
    district_id: 'minhang', source_ids: [MINHANG_SOURCE.source_id], ...MINHANG_SOURCE,
  },
  {
    id: 'heritage:shanghai_national_instrument_making', type: 'heritage', title: '上海民族乐器制作技艺',
    aliases: ['民族乐器制作'], summary: '上海民族乐器制作技艺涉及造型、雕刻、彩绘和镶嵌，二胡、古筝、琵琶等乐器制作均有地方产业与工艺传统。',
    district_id: 'minhang', source_ids: [MINHANG_SOURCE.source_id], ...MINHANG_SOURCE,
  },
  {
    id: 'heritage:huacao_small_gongs', type: 'heritage', title: '华漕小锣鼓',
    aliases: ['小锣鼓'], summary: '华漕小锣鼓被列入上海市非物质文化遗产保护活动项目，并在闵行开展传承与校园展示。',
    district_id: 'minhang', source_ids: ['src_shanghai_ich_inheritor_evaluation'], ...INHERITOR_SOURCE,
  },
  {
    id: 'heritage:minhang_hook_crochet', type: 'heritage', title: '钩针编织技艺',
    aliases: ['钩针编结'], summary: '钩针编织技艺出现在上海市2022—2024年度市级非遗代表性传承活动评估名单，所属区为闵行区。',
    district_id: 'minhang', source_ids: [INHERITOR_SOURCE.source_id], ...INHERITOR_SOURCE,
  },
  {
    id: 'heritage:xuhang_grass_braid', type: 'heritage', title: '徐行草编',
    aliases: ['草编'], summary: '徐行草编出现在上海市市级非遗代表性传承活动评估名单，所属区为嘉定区，保护单位为徐行黄草编织专业合作社。',
    district_id: 'jiading', source_ids: [INHERITOR_SOURCE.source_id], ...INHERITOR_SOURCE,
  },
  {
    id: 'heritage:chongming_pickled_vegetables', type: 'heritage', title: '酱菜制作技艺（崇明甜包瓜、草头盐齑）',
    aliases: ['崇明酱菜'], summary: '上海市非物质文化遗产代表性项目名录扩展项目将崇明甜包瓜制作技艺、草头盐齑制作技艺列入传统技艺类别。',
    district_id: 'chongming', source_ids: [SHANGHAI_CATALOG_SOURCE.source_id], ...SHANGHAI_CATALOG_SOURCE,
  },
  {
    id: 'heritage:jiading_bamboo_carving', type: 'heritage', title: '嘉定竹刻',
    aliases: ['竹刻'], summary: '嘉定竹刻以竹材为主要载体，结合书画、雕刻与文人审美，是上海传统竹工艺的重要项目。',
    district_id: 'jiading', source_ids: ['src_ihchina_jiading_bamboo'],
    source_title: '中国非物质文化遗产网：竹刻（嘉定竹刻）', source_url: 'https://www.ihchina.cn/project_details/14031',
  },
  {
    id: 'heritage:shanghai_monthly_card', type: 'heritage', title: '月份牌年画',
    aliases: ['月份牌', '上海年画'], summary: '月份牌年画以月份图像、广告画面和城市生活视觉为特色，属于上海年画与月份牌传统的代表性内容。',
    district_id: 'huangpu', source_ids: [INHERITOR_SOURCE.source_id], ...INHERITOR_SOURCE,
  },
  {
    id: 'heritage:chongming_plain_weaving', type: 'heritage', title: '崇明土布纺织技艺',
    aliases: ['崇明土布'], summary: '崇明土布纺织技艺从棉花处理、纺线到织造形成完整的传统生活织物工序。',
    district_id: 'chongming', source_ids: ['src_shgov_chongming_profile'],
    source_title: '上海市人民政府：崇明区土布纺织技艺', source_url: 'https://www.shanghai.gov.cn/chongming/index.html',
  },
  {
    id: 'heritage:fengxian_kite_making', type: 'heritage', title: '奉贤风筝制作技艺',
    aliases: ['奉贤风筝'], summary: '奉贤风筝制作技艺以竹材扎制骨架，再配合糊纸、绘制和试飞等工序完成风筝。',
    district_id: 'fengxian', source_ids: ['src_fengxian_mao_kite_history'],
    source_title: '奉贤区风筝制作技艺项目介绍', source_url: 'https://www.fengxian.gov.cn/wlj/whycbh/fwzwhyc/20150724/2302-4b912859-c8a3-4d99-b4af-a4bcb0cf08b7.html',
  },
  {
    id: 'heritage:nanqiao_paper_cutting', type: 'heritage', title: '南桥撕纸',
    aliases: ['撕纸'], summary: '南桥撕纸以纸张为材料，通过撕、折、拼接等方式形成装饰与叙事图样，是奉贤纸艺活动中的代表性内容。',
    district_id: 'fengxian', source_ids: ['src_fengxian_nanqiao_intro'],
    source_title: '六月奉贤：南桥撕纸活动介绍', source_url: 'https://www.fengxian.gov.cn/bmts/20250618/90911.html',
  },
];

export const GRAPH_SEED_EDGES = [
  ['heritage:SHIH_0007', 'BELONGS_TO_TRADITION', 'tradition:jiangnan_shadow', MINHANG_SOURCE],
  ['heritage:SHIH_0007', 'BELONGS_TO_TRADITION', 'tradition:chinese_shadow_puppetry', SHADOW_SOURCE],
  ['heritage:SHIH_0007', 'USES_MATERIAL', 'material:animal_hide', SHADOW_SOURCE],
  ['heritage:SHIH_0007', 'USES_MATERIAL', 'material:paperboard', SHADOW_SOURCE],
  ['heritage:tangshan_shadow', 'BELONGS_TO_TRADITION', 'tradition:chinese_shadow_puppetry', TANGSHAN_SHADOW_SOURCE],
  ['heritage:tangshan_shadow', 'USES_MATERIAL', 'material:animal_hide', TANGSHAN_SHADOW_SOURCE],
  ['heritage:SHIH_0001', 'BELONGS_TO_TRADITION', 'tradition:traditional_bamboo_craft', { source_id: 'src_ihchina_jiading_bamboo', source_title: '竹刻（嘉定竹刻）', source_url: 'https://www.ihchina.cn/project_details/14031' }],
  ['heritage:SHIH_0001', 'USES_MATERIAL', 'material:bamboo', { source_id: 'src_ihchina_jiading_bamboo', source_title: '竹刻（嘉定竹刻）', source_url: 'https://www.ihchina.cn/project_details/14031' }],
  ['heritage:SHIH_0002', 'BELONGS_TO_TRADITION', 'tradition:paper_art', { source_id: 'src_fengxian_nanqiao_intro', source_title: '六月奉贤：南桥撕纸活动介绍', source_url: 'https://www.fengxian.gov.cn/bmts/20250618/90911.html' }],
  ['heritage:SHIH_0002', 'USES_MATERIAL', 'material:paperboard', { source_id: 'src_fengxian_nanqiao_intro', source_title: '六月奉贤：南桥撕纸活动介绍', source_url: 'https://www.fengxian.gov.cn/bmts/20250618/90911.html' }],
  ['heritage:SHIH_0003', 'BELONGS_TO_TRADITION', 'tradition:traditional_textile', { source_id: 'src_sh_agri_textiles', source_title: '沪郊土布的前世今生', source_url: 'https://nyncw.sh.gov.cn/mtbd/20240909/f29c2154d7d44cd2bfe4b6319c2961ff.html' }],
  ['heritage:SHIH_0005', 'BELONGS_TO_TRADITION', 'tradition:traditional_textile', { source_id: 'src_shgov_chongming_profile', source_title: '崇明区·土布纺织技艺', source_url: 'https://www.shanghai.gov.cn/chongming/index.html' }],
  ['heritage:SHIH_0005', 'USES_MATERIAL', 'material:cotton', { source_id: 'src_shgov_chongming_profile', source_title: '崇明区·土布纺织技艺', source_url: 'https://www.shanghai.gov.cn/chongming/index.html' }],
  ['heritage:SHIH_0006', 'BELONGS_TO_TRADITION', 'tradition:shanghai_new_year_picture', { source_id: 'src_ihchina_new_year_pictures', source_title: '新春话年画', source_url: 'https://www.ihchina.cn/news_1_details/10351.html' }],
  ['heritage:SHIH_0007', 'BELONGS_TO_TRADITION', 'tradition:jiangnan_shadow', MINHANG_SOURCE],
  ['heritage:SHIH_0008', 'BELONGS_TO_TRADITION', 'tradition:kite_making', { source_id: 'src_fengxian_mao_kite_history', source_title: '奉贤区风筝制作技艺项目介绍', source_url: 'https://www.fengxian.gov.cn/wlj/whycbh/fwzwhyc/20150724/2302-4b912859-c8a3-4d99-b4af-a4bcb0cf08b7.html' }],
  ['heritage:SHIH_0008', 'USES_MATERIAL', 'material:bamboo', { source_id: 'src_fengxian_mao_kite_history', source_title: '奉贤区风筝制作技艺项目介绍', source_url: 'https://www.fengxian.gov.cn/wlj/whycbh/fwzwhyc/20150724/2302-4b912859-c8a3-4d99-b4af-a4bcb0cf08b7.html' }],
  ['heritage:SHIH_0004', 'USES_MATERIAL', 'material:ivory', IVORY_POLICY_SOURCE],
  ['heritage:minhang_hand_lion_dance', 'BELONGS_TO_TRADITION', 'tradition:traditional_folk_dance', MINHANG_SOURCE],
  ['heritage:shanghai_national_instrument_making', 'BELONGS_TO_TRADITION', 'tradition:jiangnan_music', MINHANG_SOURCE],
  ['heritage:huacao_small_gongs', 'BELONGS_TO_TRADITION', 'tradition:jiangnan_music', INHERITOR_SOURCE],
  ['heritage:minhang_hook_crochet', 'BELONGS_TO_TRADITION', 'tradition:traditional_textile', INHERITOR_SOURCE],
  ['heritage:xuhang_grass_braid', 'BELONGS_TO_TRADITION', 'tradition:traditional_bamboo_craft', INHERITOR_SOURCE],
  ['heritage:chongming_pickled_vegetables', 'BELONGS_TO_TRADITION', 'tradition:traditional_food_craft', SHANGHAI_CATALOG_SOURCE],
  ['heritage:jiading_bamboo_carving', 'BELONGS_TO_TRADITION', 'tradition:traditional_bamboo_craft', { source_id: 'src_ihchina_jiading_bamboo', source_title: '竹刻（嘉定竹刻）', source_url: 'https://www.ihchina.cn/project_details/14031' }],
  ['heritage:jiading_bamboo_carving', 'USES_MATERIAL', 'material:bamboo', { source_id: 'src_ihchina_jiading_bamboo', source_title: '竹刻（嘉定竹刻）', source_url: 'https://www.ihchina.cn/project_details/14031' }],
  ['heritage:shanghai_monthly_card', 'BELONGS_TO_TRADITION', 'tradition:shanghai_new_year_picture', INHERITOR_SOURCE],
  ['heritage:chongming_plain_weaving', 'BELONGS_TO_TRADITION', 'tradition:traditional_textile', { source_id: 'src_shgov_chongming_profile', source_title: '上海市人民政府：崇明区土布纺织技艺', source_url: 'https://www.shanghai.gov.cn/chongming/index.html' }],
  ['heritage:chongming_plain_weaving', 'USES_MATERIAL', 'material:cotton', { source_id: 'src_shgov_chongming_profile', source_title: '上海市人民政府：崇明区土布纺织技艺', source_url: 'https://www.shanghai.gov.cn/chongming/index.html' }],
  ['heritage:fengxian_kite_making', 'BELONGS_TO_TRADITION', 'tradition:kite_making', { source_id: 'src_fengxian_mao_kite_history', source_title: '奉贤区风筝制作技艺项目介绍', source_url: 'https://www.fengxian.gov.cn/wlj/whycbh/fwzwhyc/20150724/2302-4b912859-c8a3-4d99-b4af-a4bcb0cf08b7.html' }],
  ['heritage:fengxian_kite_making', 'USES_MATERIAL', 'material:bamboo', { source_id: 'src_fengxian_mao_kite_history', source_title: '奉贤区风筝制作技艺项目介绍', source_url: 'https://www.fengxian.gov.cn/wlj/whycbh/fwzwhyc/20150724/2302-4b912859-c8a3-4d99-b4af-a4bcb0cf08b7.html' }],
  ['heritage:nanqiao_paper_cutting', 'BELONGS_TO_TRADITION', 'tradition:paper_art', { source_id: 'src_fengxian_nanqiao_intro', source_title: '六月奉贤：南桥撕纸活动介绍', source_url: 'https://www.fengxian.gov.cn/bmts/20250618/90911.html' }],
  ['heritage:nanqiao_paper_cutting', 'USES_MATERIAL', 'material:paperboard', { source_id: 'src_fengxian_nanqiao_intro', source_title: '六月奉贤：南桥撕纸活动介绍', source_url: 'https://www.fengxian.gov.cn/bmts/20250618/90911.html' }],
].map(([from, relation, to, source]) => ({ from, relation, to, ...source }));
