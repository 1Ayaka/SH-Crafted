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
    districtVerified: false,         // 仅证据实体出现一次“上海市静安区”（指匠人所在地），地区待核对
    category: '传统技艺',
    categoryVerified: false,
    heroFrame: 'media/keyframes/000091000.jpg',      // 象牙丝编织团扇
    finishFrame: 'media/keyframes/000091000.jpg',
    anchor: { x: 0.5, y: 0.45 },
    works: [
      { frame: 'media/keyframes/000091000.jpg', name: '象牙丝编织团扇展品', evidenceId: 'ev_SHIH_0004_0075000_0107000' },
      { frame: 'media/keyframes/000056400.jpg', name: '牙雕工艺品（摆件、佛像）', evidenceId: 'ev_SHIH_0004_0052000_0074000' },
      { frame: 'media/keyframes/000244000.jpg', name: '清代象牙编织团扇文物与记载', evidenceId: 'ev_SHIH_0004_0232000_0328000' },
    ],
  },
};

export const CRAFT_ORDER = ['SHIH_0001', 'SHIH_0002', 'SHIH_0003', 'SHIH_0004'];

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
// 四门工艺均有原料模型；药斑布无独立成品模型——成品为同一布面 + 纪录片纹样取色（pattern）
// 南桥撕纸无成品模型，完成态保持平面关键帧呈现
export const CRAFT_MODEL_PATHS = {
  SHIH_0001: {
    raw: 'assets/models/crafts/bamboo-raw.glb',        // 竹子模型（原料）
    finished: 'assets/models/crafts/bamboo-finished.glb', // 竹雕完成品
  },
  SHIH_0002: {
    raw: 'assets/models/crafts/paper-raw.glb',         // 剪纸原料（纸平面）
    rawTint: 0xD8CCAF,                                 // 未撕白纸（略深于砂底，保证可读）
    finished: null,                                    // 无成品模型：平面关键帧呈现
  },
  SHIH_0003: {
    raw: 'assets/models/crafts/cloth-raw.glb',         // 药斑布原料（布平面）
    rawTint: 0xC4AE8C,                                 // 未染本色棉布（略深于砂底，保证可读）
    finished: 'assets/models/crafts/cloth-raw.glb',    // 成品 = 同一布面 + 纹样取色
    pattern: 'assets/patterns/yaobanbu-pattern.jpg',   // 纹样取自纪录片关键帧 000937800（蓝白菊花纹）
  },
  SHIH_0004: {
    raw: 'assets/models/crafts/ivory-raw.glb',         // 象牙模型（原料）
    finished: 'assets/models/crafts/ivory-finished.glb',  // 象牙扇子完成品
  },
};
