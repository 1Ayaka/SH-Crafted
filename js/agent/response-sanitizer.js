const INTERNAL_ID_PREFIXES = 'ev|ext|fact|chunk|claim|step|summary|content|entity|source';
const BRACKETED_INTERNAL_ID = new RegExp(`[【\\[]\\s*(?:${INTERNAL_ID_PREFIXES})_[A-Za-z0-9_.:-]+\\s*[】\\]]`, 'gi');
const BARE_INTERNAL_ID = new RegExp(`(?:${INTERNAL_ID_PREFIXES})_[A-Za-z0-9_.:-]+`, 'gi');
const BRACKETED_NUMERIC_REFERENCE = /[【\[]\s*\d{6,}(?:[_-]\d+)+\s*[】\]]/g;

export function sanitizeAgentText(value) {
  return String(value || '')
    .replace(/```(?:json|markdown|md|text)?/gi, '')
    .replace(/```/g, '')
    .replace(/<a\b[^>]*>(.*?)<\/a>/gis, '$1')
    .replace(/^\s*\[[^\]]+\]:\s*\S+.*$/gm, '')
    .replace(/!\[([^\]]*)\]\([^\s)]*(?:\s+['"][^'"]*['"])?\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^\s)]*(?:\s+['"][^'"]*['"])?\)/g, '$1')
    .replace(/<https?:\/\/[^>\s]+>/gi, '')
    .replace(/https?:\/\/[^\s<>()，。！？；：、】）》"']+/gi, '')
    .replace(BRACKETED_INTERNAL_ID, '')
    .replace(BARE_INTERNAL_ID, '')
    .replace(BRACKETED_NUMERIC_REFERENCE, '')
    .replace(/(?:（资料）\s*){2,}/g, '（资料）')
    .replace(/[ \t]+([，。！？；：])/g, '$1')
    .replace(/\(\s*\)|（\s*）/g, '')
    .replace(/(^|\n)\s*[，；：]\s*/g, '$1')
    .replace(/([。！？])\s*\1+/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}
