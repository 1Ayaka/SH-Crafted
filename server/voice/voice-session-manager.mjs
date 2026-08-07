import { randomBytes } from 'node:crypto';

export function createVoiceSessionManager({ ttlMs = 5 * 60 * 1000, maxPerIp = 2, bindIp = false } = {}) {
  const sessions = new Map();
  const issuedByIp = new Map();
  const prune = () => {
    const now = Date.now();
    for (const [id, session] of sessions) if (session.expiresAt <= now || session.used) sessions.delete(id);
    for (const [ip, entries] of issuedByIp) {
      const current = entries.filter((entry) => entry.expiresAt > now && sessions.has(entry.id));
      if (current.length) issuedByIp.set(ip, current); else issuedByIp.delete(ip);
    }
  };
  const create = ({ ip = 'unknown', contextRevision = 'unknown' } = {}) => {
    prune();
    const list = issuedByIp.get(ip) || [];
    if (list.length >= maxPerIp) throw new Error('VOICE_RATE_LIMITED');
    const id = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + ttlMs;
    sessions.set(id, { id, ip, contextRevision: String(contextRevision).slice(0, 120), expiresAt, used: false });
    issuedByIp.set(ip, [...list, { id, expiresAt }]);
    return { session_id: id, expires_in: Math.ceil(ttlMs / 1000), context_revision: contextRevision };
  };
  const consume = (id, ip = 'unknown') => {
    prune();
    const session = sessions.get(String(id || ''));
    if (!session || session.used || session.expiresAt <= Date.now()) throw new Error('VOICE_SESSION_INVALID');
    if (bindIp && session.ip !== ip && session.ip !== 'unknown') throw new Error('VOICE_SESSION_INVALID');
    session.used = true;
    const issued = issuedByIp.get(session.ip) || [];
    const remaining = issued.filter((entry) => entry.id !== session.id);
    if (remaining.length) issuedByIp.set(session.ip, remaining); else issuedByIp.delete(session.ip);
    return session;
  };
  return { create, consume, prune, size: () => sessions.size };
}
