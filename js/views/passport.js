// 数据护照：来源、授权、审核状态、计数 —— 全部来自 manifest 真实字段
import { el } from '../ui.js';
import { hydrateAllCrafts, isContentReviewed, knowledgeOverview } from '../data.js';
import { topNav } from './home.js';
import { agent } from '../agent.js';

const RIGHTS = { pending: '授权待确认' };

export async function passportView(root) {
  // The evidence passport is intentionally the one route that needs every
  // source package. Home, map and ordinary detail navigation stay lightweight.
  const crafts = await hydrateAllCrafts();
  const knowledge = knowledgeOverview();
  const kbStats = knowledge.stats || {};
  const coveredDistricts = new Set(crafts.map((c) => c.config.districtId).filter(Boolean)).size;
  const remainingDistricts = Math.max(0, 16 - coveredDistricts);
  const tableLabels = ['项目', '来源与处理模型', '授权状态', '人工审核', '视频数据', '知识库', '生成时间'];
  const rows = crafts.map((c) => {
    const m = c.manifest || {};
    const v = m.video || {};
    const counts = m.counts || {};
    const isManaged = Boolean(c.config?.community);
    const packageId = m.package_id || c.craftId;
    const videoId = v.video_id || (isManaged ? '无独立视频' : c.craftId);
    const rightsStatus = v.rights_status || (isManaged ? '由投稿/导入资料约定' : '待确认');
    const generatedAt = m.generated_at || c.communityDetails?.updated_at || c.communityDetails?.created_at;
    const cells = [
      el('td', {}, [
        el('b', { text: c.title }),
        el('p', { class: 'mono', text: `${packageId} / ${videoId}` }),
      ]),
      el('td', {}, [
        el('p', { text: isManaged ? '协作者投稿或管理员导入' : '火山引擎视频理解（长视频多模态）' }),
        el('p', { class: 'mono', text: `来源文件：${v.source_filename || c.config?.contentSource || '未登记'}` }),
        m.provider ? el('p', { class: 'mono', text: `处理模式：${m.provider.mode || '未登记'} · ${m.provider.prompt_version || '未登记'}` }) : null,
      ]),
      el('td', {}, [
        el('span', { class: 'tag tag-review', text: RIGHTS[rightsStatus] || rightsStatus }),
        el('p', { class: 'mono', text: `rights_status: ${v.rights_status || 'not_recorded'}` }),
      ]),
      el('td', {}, [
        isContentReviewed() ? null : el('span', { class: 'tag tag-review', text: '待审核' }),
        el('p', { class: 'mono', text: `verified_claims: ${counts.verified_claims || 0} / ${counts.claims ?? c.claims?.length ?? 0}` }),
        el('p', { class: 'mono', text: `human_review: ${isContentReviewed() ? 'confirmed' : 'not_started'}` }),
      ]),
      el('td', {}, [
        el('p', { class: 'mono', text: `证据 ${counts.evidence ?? c.evidence?.length ?? 0} · 知识 ${counts.claims ?? c.claims?.length ?? 0} · 工序 ${counts.process_steps ?? c.steps?.length ?? 0} · 关键帧 ${counts.keyframes ?? c.config?.works?.length ?? 0}` }),
        el('p', { class: 'mono', text: v.duration_ms ? `时长 ${Math.round(v.duration_ms / 1000)}s · ${v.width || '-'}×${v.height || '-'} · 播放地址：${v.playback_url ? '已接入' : '未接入'}` : '未登记独立纪录片视频' }),
      ]),
      el('td', {}, [
        el('p', { class: 'mono', text: `统一片段 ${kbStats.per_craft?.[c.craftId]?.chunks || 0}` }),
        el('p', { class: 'mono', text: `外部事实 ${kbStats.per_craft?.[c.craftId]?.external_facts || 0} · 来源 ${kbStats.per_craft?.[c.craftId]?.sources || 0}` }),
      ]),
      el('td', {}, [
        el('p', { class: 'mono', text: generatedAt ? new Date(generatedAt).toLocaleString('zh-CN') : '未登记' }),
      ]),
    ];
    cells.forEach((cell, index) => {
      cell.setAttribute('data-label', tableLabels[index]);
      cell.setAttribute('aria-label', tableLabels[index]);
    });
    return el('tr', {}, cells);
  });

  const authorityCards = ['A', 'B', 'C'].map((tier) => el('div', { class: 'kb-stat' }, [
    el('strong', { text: String(kbStats.authority?.[tier] || 0) }),
    el('span', { text: `${tier} 级来源` }),
    el('small', { text: knowledge.authorityPolicy?.[tier] || '' }),
  ]));
  const sourceGroups = ['A', 'B', 'C'].map((tier) => {
    const sources = knowledge.sources
      .filter((source) => source.authority_tier === tier)
      .sort((a, b) => a.publisher.localeCompare(b.publisher, 'zh-CN'));
    return el('details', { class: 'kb-source-group' }, [
      el('summary', { text: `${tier} 级可靠来源（${sources.length}）` }),
      el('div', { class: 'kb-source-list' }, sources.map((source) => el('a', {
        href: source.url, target: '_blank', rel: 'noopener noreferrer',
      }, [
        el('b', { text: source.title }),
        el('span', { text: source.publisher }),
      ]))),
    ]);
  });

  root.appendChild(el('section', { class: 'view' }, [
    topNav('passport'),
    el('div', { class: 'passport' }, [
      el('h2', { text: '数据护照' }),
      el('p', {
        class: 'sub',
        text: isContentReviewed() ? '本页展示每个数据包的来源、授权范围、模型处理方式与专家审核状态。' : '本页展示每个数据包的来源、授权范围、模型处理方式与人工审核状态。未确认的知识草稿、工艺步骤与证据会标注“待审核”，不覆盖原始资料。',
      }),
      el('section', { class: 'kb-overview', 'aria-label': '知识库概览' }, [
        el('div', { class: 'kb-overview-head' }, [
          el('div', {}, [
            el('h3', { text: '网页支撑知识库' }),
            el('p', { text: '统一索引已接入“小蕉”检索。外部事实采用转述摘要，并保留发布机构、原文链接、权威等级和审核状态。' }),
          ]),
          el('div', { class: 'kb-total' }, [
            el('strong', { text: String(kbStats.total_chunks || 0) }),
            el('span', { text: '条可检索知识片段' }),
          ]),
        ]),
        el('div', { class: 'kb-stats' }, [
          el('div', { class: 'kb-stat primary' }, [
            el('strong', { text: String(kbStats.external_facts || 0) }),
            el('span', { text: '条外部事实' }),
            el('small', { text: `${kbStats.review_status?.verified_external || 0} 条已由外部权威资料核验` }),
          ]),
          el('div', { class: 'kb-stat primary' }, [
            el('strong', { text: String(kbStats.external_sources || 0) }),
            el('span', { text: '个登记来源' }),
            el('small', { text: '百科、自媒体、电商与无署名转载不单独支撑事实' }),
          ]),
          ...authorityCards,
        ]),
        el('div', { class: 'kb-source-browser' }, [
          el('h4', { text: '来源目录' }),
          ...sourceGroups,
        ]),
      ]),
      el('table', {}, [
        el('thead', {}, el('tr', {}, tableLabels.map((h) => el('th', { text: h })))),
        el('tbody', {}, rows),
      ]),
      el('p', { class: 'foot-note', text: `目录生成时间：${new Date(crafts[0] ? crafts[0].manifest.generated_at : Date.now()).toLocaleString('zh-CN')} · 视频文件尚未接入播放（playback_url 为空），页面证据以关键帧 + 转写原文 + 时间码形式呈现。其余 ${remainingDistricts} 个行政区与更多项目：资料待接入。` }),
    ]),
  ]));
  agent.unmount();
  return { cleanup() {} };
}
