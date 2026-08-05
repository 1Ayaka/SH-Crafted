// 策展与版式配置（人工编辑，非自动抽取事实）
// 注意：本文件中的“类别”“空间锚点”属于策展配置，不代表官方名录核定结果。

// 16 区示意瓦片：viewBox 100 x 76 平面布局，大致符合上海相对地理
// （崇明岛居北、浦东居东沿海、市区居中、西南为青浦松江金山）
export const DISTRICTS = [
  { id: 'chongming', name: '崇明区', x: 30, y: 2,  w: 30, h: 9,  r: 4.5 },
  { id: 'baoshan',   name: '宝山区', x: 47, y: 14, w: 13, h: 8,  r: 2.5 },
  { id: 'jiading',   name: '嘉定区', x: 30, y: 13, w: 15, h: 10, r: 3 },
  { id: 'qingpu',    name: '青浦区', x: 10, y: 24, w: 17, h: 12, r: 3.5 },
  { id: 'songjiang', name: '松江区', x: 14, y: 38, w: 17, h: 11, r: 3.5 },
  { id: 'jinshan',   name: '金山区', x: 12, y: 51, w: 18, h: 11, r: 3.5 },
  { id: 'fengxian',  name: '奉贤区', x: 36, y: 49, w: 17, h: 11, r: 3.5 },
  { id: 'minhang',   name: '闵行区', x: 34, y: 37, w: 13, h: 10, r: 3 },
  { id: 'pudong',    name: '浦东新区', x: 64, y: 26, w: 13, h: 34, r: 4 },
  { id: 'xuhui',     name: '徐汇区', x: 44, y: 33, w: 8,  h: 6,  r: 2 },
  { id: 'changning', name: '长宁区', x: 40, y: 27, w: 7,  h: 5,  r: 2 },
  { id: 'putuo',     name: '普陀区', x: 43, y: 21, w: 7,  h: 5,  r: 2 },
  { id: 'jingan',    name: '静安区', x: 51, y: 25, w: 7,  h: 5,  r: 2 },
  { id: 'huangpu',   name: '黄浦区', x: 53, y: 31, w: 7,  h: 5.5, r: 2 },
  { id: 'hongkou',   name: '虹口区', x: 56, y: 19, w: 7,  h: 5,  r: 2 },
  { id: 'yangpu',    name: '杨浦区', x: 60, y: 13, w: 8,  h: 5.5, r: 2 },
];

// 地区介绍内容。依据上海市人民政府、上海市民政局公开资料压缩整理。
export const DISTRICT_PROFILES = {
  jiading:  {
    name: '嘉定区',
    origin: '南宋嘉定十年（1217年）置县，以当时的年号“嘉定”为名。',
    features: '嘉定兼有古镇水乡、文人书画与现代城市风貌，南翔、嘉定镇等地保存了深厚的江南文脉。',
    heritageOverview: '嘉定竹刻、徐行草编、南翔小笼制作技艺、嘉定道教音乐等项目，呈现出雕刻、编织、饮食与民间音乐并存的地方传统。',
    sourceLabel: '上海市人民政府 · 嘉定区', sourceUrl: 'https://www.shanghai.gov.cn/jiading/index.html',
  },
  fengxian: {
    name: '奉贤区',
    origin: '相传孔子弟子言偃曾到此讲学，“奉贤”寄托了敬奉贤人、见贤思齐之意。',
    features: '奉贤南临杭州湾，江南乡土文化与滨海新城相互交织，“贤文化”是鲜明的区域文化标识。',
    heritageOverview: '南桥撕纸、奉贤滚灯、江南孙氏二胡艺术等项目，连接民间美术、节庆表演和传统音乐。',
    sourceLabel: '上海市人民政府 · 奉贤区', sourceUrl: 'https://www.shanghai.gov.cn/fengxian/index.html',
  },
  jingan:   {
    name: '静安区',
    origin: '静安区因境内古老的静安寺得名，历史上也曾称“静安寺区”。',
    features: '静安地跨苏州河两岸，历史建筑、红色遗址、剧场与现代商业共同构成浓厚的海派城市文化。',
    heritageOverview: '龙凤旗袍制作技艺、奉帮裁缝缝纫技艺、鲁庵印泥制作技艺等，体现上海服饰、手工与文房传统。',
    sourceLabel: '上海市民政局 · 静安区地名文化', sourceUrl: 'https://mzj.sh.gov.cn/2023bsmz/20230611/e814f72c4fdf491b96df2228cd282046.html',
  },
  chongming:{
    name: '崇明区',
    origin: '“崇明”沿用自五代时期设于长江口沙洲上的崇明镇，后来成为县名并延续为区名。',
    features: '崇明位于长江口，岛屿由泥沙冲积形成；江海共生的生产生活塑造了鲜明的沙地文化与生态气质。',
    heritageOverview: '崇明土布、剪纸、灶花、天气谚语等传统，记录了岛民纺织、节俗、居住与观察自然的生活经验。',
    sourceLabel: '上海市人民政府 · 崇明区', sourceUrl: 'https://www.shanghai.gov.cn/chongming/index.html',
  },
  minhang:  {
    name: '闵行区',
    origin: '闵行因历史上的闵行镇得名；“闵行”旧有“敏行”写法，明代已见相关地名记载。',
    features: '闵行连接中心城区与上海西南部，七宝古镇、马桥遗址和浦江乡土文化共同构成多层次的地域记忆。',
    heritageOverview: '七宝皮影戏、江南丝竹、民族乐器制作技艺及沪谚等项目，保留了古镇表演、音乐制作与口头传统。',
    sourceLabel: '上海市人民政府 · 闵行区', sourceUrl: 'https://www.shanghai.gov.cn/minhang/index.html',
  },
  baoshan: {
    name: '宝山区',
    origin: '宝山因山得名。今天的区名沿用历史上的宝山县名，见证了吴淞口一带由江海门户向城市北部城区的发展。',
    features: '宝山位于长江与黄浦江交汇处，吴淞滨江、工业遗存、罗店古镇与乡村文化共同构成鲜明的江海气质。',
    heritageOverview: '罗店划龙船习俗、罗泾十字挑花、罗店彩灯与宝山沪剧等项目，连接节庆、织绣、灯彩和地方戏曲传统。',
    sourceLabel: '上海市人民政府 · 宝山区', sourceUrl: 'https://www.shanghai.gov.cn/baoshan/index.html',
  },
  qingpu: {
    name: '青浦区',
    origin: '明嘉靖二十一年（1542年）置青浦县，今天的区名沿用这一历史地名。',
    features: '青浦地处上海西部，河港湖荡密布；朱家角古镇、青龙镇遗址与淀山湖共同保存了浓厚的江南水乡记忆。',
    heritageOverview: '田山歌、摇快船、船拳及传统镶嵌等地方项目，呈现青浦水乡的生产生活、节庆表演与手工技艺。',
    sourceLabel: '上海市人民政府 · 青浦区', sourceUrl: 'https://www.shanghai.gov.cn/qingpu/index.html',
  },
  songjiang: {
    name: '松江区',
    origin: '松江区名沿用松江府、松江县等历史地名。唐天宝十年（751年）设华亭县，是上海地区较早的县级建置。',
    features: '松江拥有广富林文化遗址、方塔、佘山和松江府城文脉，常被称为“上海之根”。',
    heritageOverview: '顾绣、松江剪纸、松江皮影及地方传统武术等项目，延续了书画、刺绣、民间美术与表演传统。',
    sourceLabel: '上海市人民政府 · 松江区', sourceUrl: 'https://www.shanghai.gov.cn/songjiang/index.html',
  },
  jinshan: {
    name: '金山区',
    origin: '金山区名与杭州湾海域的大金山、小金山等岛屿相关，历史地名在行政建置调整中延续至今。',
    features: '金山南临杭州湾，枫泾古镇、金山嘴渔村与滨海乡村共同形成水乡、渔业和海洋文化交织的区域面貌。',
    heritageOverview: '金山农民画、上海黄酒传统酿造技艺、枫泾丁蹄、朱泾花灯与金山堰菜等项目具有鲜明的乡土特色。',
    sourceLabel: '上海市人民政府 · 金山区', sourceUrl: 'https://www.shanghai.gov.cn/jinshan/index.html',
  },
  pudong: {
    name: '浦东新区',
    origin: '“浦东”意指黄浦江以东地区。1990年代浦东开发开放后，浦东新区成为正式行政区名并沿用至今。',
    features: '浦东既有陆家嘴的现代城市景观，也保留川沙、三林、惠南等地的古镇、乡村与滨海文化。',
    heritageOverview: '上海绒绣、浦东派琵琶、浦东说书、锣鼓书与浦东绕龙灯等项目，覆盖传统美术、音乐、曲艺和舞蹈。',
    sourceLabel: '上海市人民政府 · 浦东新区', sourceUrl: 'https://www.shanghai.gov.cn/pudong/index.html',
  },
  nanhui: {
    name: '原南汇区域',
    origin: '南汇是上海历史行政区名称；2009年原南汇区并入浦东新区。地图保留其轮廓，用于呈现浦东东南部的地域文化。',
    features: '原南汇区域面向东海与杭州湾，惠南、新场、大团等地形成了兼具古镇、盐棉生产和滨海生活的文化景观。',
    heritageOverview: '鸟哨、灶花、石雕、浦东说书等项目曾以南汇地区申报或广泛流传，记录了当地节俗、手工和口头传统。',
    sourceLabel: '上海市人民政府 · 南汇区划调整', sourceUrl: 'https://www.shanghai.gov.cn/nw9822/20200906/0001-9822_336024.html',
  },
};

// 工艺策展配置：地区归属、类别（待核对）、代表关键帧、空间锚点（策展空间位置，非实际地址）
export const CRAFT_CONFIG = {
  SHIH_0001: {
    craftName: '嘉定竹刻',
    districtId: 'jiading',
    districtLabel: '嘉定区',
    districtVerified: true,          // claims/证据多处出现“嘉定”
    category: '传统美术',
    categoryVerified: false,
    heroFrame: 'media/keyframes/000443000.jpg',      // 起稿—成品竹笔筒画面
    finishFrame: 'media/keyframes/000443000.jpg',
    anchor: { x: 0.36, y: 0.40 },                    // 策展空间位置（非实际地址）
    works: [
      { frame: 'media/keyframes/000443000.jpg', name: '竹刻起稿与竹笔筒成品', evidenceId: 'ev_SHIH_0001_0436000_0471000' },
      { frame: 'media/keyframes/000551200.jpg', name: '吴之藩竹刻作品（乾隆题诗）', evidenceId: 'ev_SHIH_0001_0516000_0560000' },
      { frame: 'media/keyframes/000823875.jpg', name: '《松壑云泉图》笔筒等作品', evidenceId: 'ev_SHIH_0001_0812000_0907000' },
    ],
  },
  SHIH_0002: {
    craftName: '南桥撕纸',
    districtId: 'fengxian',
    districtLabel: '奉贤区',
    districtVerified: true,          // claims 明确“奉贤区非物质文化遗产项目”
    category: '传统美术',
    categoryVerified: false,
    heroFrame: 'media/keyframes/000052400.jpg',      // 红色撕纸龙
    finishFrame: 'media/keyframes/000052400.jpg',
    anchor: { x: 0.5, y: 0.42 },
    works: [
      { frame: 'media/keyframes/000052400.jpg', name: '红色撕纸作品（龙纹）', evidenceId: 'ev_SHIH_0002_0030000_0058000' },
      { frame: 'media/keyframes/000257500.jpg', name: '南桥撕纸主题作品与教学', evidenceId: 'ev_SHIH_0002_0232000_0283000' },
      { frame: 'media/keyframes/000394750.jpg', name: '撕纸传承与教学场景', evidenceId: 'ev_SHIH_0002_0295000_0409000' },
    ],
  },
  SHIH_0003: {
    craftName: '药斑布',
    districtId: 'jiading',
    districtLabel: '嘉定区',
    districtVerified: true,          // 证据地点：上海市嘉定区安亭镇
    category: '传统技艺',
    categoryVerified: false,
    heroFrame: 'media/keyframes/000937800.jpg',      // 蓝白纹药斑布
    finishFrame: 'media/keyframes/000937800.jpg',
    anchor: { x: 0.63, y: 0.58 },
    works: [
      { frame: 'media/keyframes/000937800.jpg', name: '药斑布服饰与布料细节', evidenceId: 'ev_SHIH_0003_0930000_0969000' },
      { frame: 'media/keyframes/000094000.jpg', name: '药斑布纹样与蓼蓝草', evidenceId: 'ev_SHIH_0003_0083000_0105000' },
      { frame: 'media/keyframes/000779250.jpg', name: '染色—刮浆—晾晒全流程', evidenceId: 'ev_SHIH_0003_0770000_0844000' },
    ],
  },
  SHIH_0004: {
    craftName: '象牙篾丝编织',
    districtId: 'jingan',
    districtLabel: '静安区',
    districtVerified: true,          // 上海市文旅推广网：静安区（原闸北区）市级项目
    category: '传统美术',
    categoryVerified: true,          // 上海市文旅推广网项目基本信息
    heroFrame: 'media/keyframes/000091000.jpg',      // 象牙丝编织团扇
    finishFrame: 'media/keyframes/000091000.jpg',
    anchor: { x: 0.5, y: 0.45 },
    works: [
      { frame: 'media/keyframes/000091000.jpg', name: '象牙丝编织团扇展品', evidenceId: 'ev_SHIH_0004_0075000_0107000' },
      { frame: 'media/keyframes/000056400.jpg', name: '牙雕工艺品（摆件、佛像）', evidenceId: 'ev_SHIH_0004_0052000_0074000' },
      { frame: 'media/keyframes/000244000.jpg', name: '清代象牙编织团扇文物与记载', evidenceId: 'ev_SHIH_0004_0232000_0328000' },
    ],
  },
  SHIH_0005: {
    craftName: '崇明土布纺织技艺',
    districtId: 'chongming',
    districtLabel: '崇明区',
    districtVerified: true,
    category: '传统技艺',
    categoryVerified: false,
    heroFrame: 'media/keyframes/000049200.jpg',
    finishFrame: 'media/keyframes/001799375.jpg',
    anchor: { x: 0.38, y: 0.42 },
    works: [
      { frame: 'media/keyframes/000049200.jpg', name: '崇明土布纵横纹理', evidenceId: 'ev_SHIH_0005_0042000_0078000' },
      { frame: 'media/keyframes/000512625.jpg', name: '土布纺织工序', evidenceId: 'ev_SHIH_0005_0492000_0657000' },
      { frame: 'media/keyframes/001799375.jpg', name: '崇明土布当代传承', evidenceId: 'ev_SHIH_0005_1670000_1877000' },
    ],
  },
  SHIH_0006: {
    craftName: '上海月份牌年画',
    districtId: 'jingan',
    districtLabel: '静安区',
    districtVerified: true,
    category: '传统美术',
    categoryVerified: false,
    heroFrame: 'media/keyframes/000201750.jpg',
    finishFrame: 'media/keyframes/000414250.jpg',
    anchor: { x: 0.66, y: 0.4 },
    works: [
      { frame: 'media/keyframes/000201750.jpg', name: '月份牌年画历史图像', evidenceId: 'ev_SHIH_0006_0123000_0213000' },
      { frame: 'media/keyframes/000414250.jpg', name: '擦笔水彩年画技法', evidenceId: 'ev_SHIH_0006_0353000_0423000' },
      { frame: 'media/keyframes/000648625.jpg', name: '月份牌年画创作与流传', evidenceId: 'ev_SHIH_0006_0429000_0680000' },
    ],
  },
  SHIH_0007: {
    craftName: '七宝皮影戏',
    districtId: 'minhang',
    districtLabel: '闵行区',
    districtVerified: true,
    category: '传统美术',
    categoryVerified: false,
    heroFrame: 'media/keyframes/000085000.jpg',
    finishFrame: 'media/keyframes/000475000.jpg',
    anchor: { x: 0.48, y: 0.45 },
    works: [
      { frame: 'media/keyframes/000085000.jpg', name: '七宝皮影演出', evidenceId: 'ev_SHIH_0007_0075000_0125000' },
      { frame: 'media/keyframes/000475000.jpg', name: '七宝皮影影人制作', evidenceId: 'ev_SHIH_0007_0395000_0523000' },
      { frame: 'media/keyframes/001122500.jpg', name: '皮影材料与灯光呈现', evidenceId: 'ev_SHIH_0007_0902000_1154000' },
    ],
  },
  SHIH_0008: {
    craftName: '毛氏风筝',
    districtId: 'fengxian',
    districtLabel: '奉贤区',
    districtVerified: true,
    category: '传统技艺',
    categoryVerified: false,
    heroFrame: 'media/keyframes/000037200.jpg',
    finishFrame: 'media/keyframes/001477500.jpg',
    anchor: { x: 0.68, y: 0.56 },
    works: [
      { frame: 'media/keyframes/000037200.jpg', name: '毛氏风筝放飞', evidenceId: 'ev_SHIH_0008_0029000_0070000' },
      { frame: 'media/keyframes/000405750.jpg', name: '毛氏风筝糊纸工序', evidenceId: 'ev_SHIH_0008_0398000_0460000' },
      { frame: 'media/keyframes/001477500.jpg', name: '毛氏风筝展示与传播', evidenceId: 'ev_SHIH_0008_1390000_1490000' },
    ],
  },
};

export const CRAFT_ORDER = [
  'SHIH_0001', 'SHIH_0002', 'SHIH_0003', 'SHIH_0004',
  'SHIH_0005', 'SHIH_0006', 'SHIH_0007', 'SHIH_0008',
];

// 人工策展的交互规则覆盖层。
// 原始 process_steps 保留自动抽取结果；这里仅描述页面如何把证据映射为“资源 + 动作”。
// 后续应迁移到每个知识包的 knowledge/interaction_rules.json 并走独立审核。
export const INTERACTION_OVERRIDES = {
  step_SHIH_0004_001: {
    action: { id: 'slice', label: '切片' },
    resource_groups: [
      { id: 'main', label: '主体材料', mode: 'all', options: ['象牙'] },
    ],
  },
  step_SHIH_0004_002: {
    action: { id: 'cut_filament', label: '切丝' },
    resource_groups: [
      { id: 'main', label: '主体材料', mode: 'all', options: ['象牙'] },
    ],
  },
  step_SHIH_0004_003: {
    action: { id: 'soak', label: '浸泡' },
    resource_groups: [
      { id: 'main', label: '主体材料', mode: 'all', options: ['象牙'] },
      { id: 'additive', label: '辅助材料', mode: 'all', options: ['酸'] },
    ],
  },
  step_SHIH_0004_004: {
    action: { id: 'weave', label: '编织' },
    resource_groups: [
      { id: 'main', label: '主体材料', mode: 'all', options: ['象牙'] },
    ],
  },
};

// 材料状态链显示文案
export const MATERIAL_STATES = {
  raw:   { label: '原料',   cls: 'state-raw' },
  mid:   { label: '中间态', cls: 'state-mid' },
  ready: { label: '可装配', cls: 'state-ready' },
};

// 粒子化三维模型（js/particlemodel.js 渲染）：原料模型 → 未开始态；成品模型 → 完成态
// 首批四门工艺有原料与成品模型；5—8 的模型稍后接入。
export const CRAFT_MODEL_PATHS = {
  SHIH_0001: {
    raw: 'assets/models/crafts/bamboo-raw.glb',        // 竹子模型（原料）
    finished: 'assets/models/crafts/bamboo-finished.web.glb?v=20260803', // 网页粒子渲染专用轻量副本
  },
  SHIH_0002: {
    raw: 'assets/models/crafts/paper-raw.glb',         // 剪纸原料（纸平面）
    rawTint: 0xD8CCAF,                                 // 未撕白纸（略深于砂底，保证可读）
    finished: 'assets/models/crafts/paper-finished.web.glb?v=20260803',
  },
  SHIH_0003: {
    raw: 'assets/models/crafts/cloth-raw.glb',         // 药斑布原料（布平面）
    rawTint: 0xC4AE8C,                                 // 未染本色棉布（略深于砂底，保证可读）
    finished: 'assets/models/crafts/cloth-finished.web.glb?v=20260803',
    pattern: 'assets/patterns/yaobanbu-pattern.jpg',   // 纹样取自纪录片关键帧 000937800（蓝白菊花纹）
  },
  SHIH_0004: {
    raw: 'assets/models/crafts/ivory-raw.glb',         // 象牙模型（原料）
    finished: 'assets/models/crafts/ivory-finished.web.glb?v=20260803',
  },
  SHIH_0007: {
    // 目前仅提供完成品模型，原料态先复用同一模型，避免体验入口回退到平面。
    raw: 'assets/models/crafts/shadow-finished.web.glb?v=20260803',
    finished: 'assets/models/crafts/shadow-finished.web.glb?v=20260803',
  },
  SHIH_0008: {
    // 目前仅提供完成品模型，原料态先复用同一模型，后续可替换为骨架/蒙面原料模型。
    raw: 'assets/models/crafts/kite-finished.web.glb?v=20260803',
    finished: 'assets/models/crafts/kite-finished.web.glb?v=20260803',
  },
};
