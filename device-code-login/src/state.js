import { randomBytes, randomInt, createHash } from 'node:crypto';
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const digest = value => createHash('sha256').update(value).digest('hex');
export class Requests {
  constructor({ now = Date.now, ttl = 600000, capacity = 100, pollMs = 1500 } = {}) {
    Object.assign(this, { now, ttl, capacity, pollMs });
    this.rows = new Map(); this.nextCreate = 0; this.nextPoll = 0;
  }
  prune() { for (const [id, row] of this.rows) if (row.expiresAt <= this.now()) this.rows.delete(id); }
  create(origin, metadata) {
    this.prune(); const now = this.now();
    if (now < this.nextCreate || this.rows.size >= this.capacity) throw new Error('rate-limited');
    this.nextCreate = now + 1000;
    let code;
    do { code = Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join(''); code = code.slice(0, 4) + '-' + code.slice(4); }
    while ([...this.rows.values()].some(row => row.code === code));
    const secret = randomBytes(32).toString('base64url');
    this.rows.set(digest(secret), { code, origin, ...metadata, createdAt: now, expiresAt: now + this.ttl, state: 'pending', nextPoll: 0 });
    return { secret, code, expiresAt: now + this.ttl, pollMs: this.pollMs };
  }
  status(secret, origin) {
    this.prune(); const now = this.now();
    if (now < this.nextPoll) throw new Error('rate-limited');
    this.nextPoll = now + 10;
    if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('unknown-request');
    const id = digest(secret), row = this.rows.get(id);
    if (!row || row.origin !== origin) throw new Error('unknown-request');
    if (now < row.nextPoll) throw new Error('rate-limited');
    row.nextPoll = now + this.pollMs;
    if (row.state === 'approved' || row.state === 'denied') this.rows.delete(id);
    return row.state;
  }
  command({ action, code }) {
    this.prune();
    const rows = [...this.rows.values()];
    const publicRow = ({ code, origin, peer, userAgent, createdAt, expiresAt, state }) => ({ code, origin, peer, userAgent, createdAt, expiresAt, state });
    if (action === 'list') return rows.map(publicRow);
    if (!['inspect', 'approve', 'deny'].includes(action) || typeof code !== 'string') throw new Error('invalid-command');
    const row = rows.find(row => row.code === code.toUpperCase());
    if (!row) throw new Error('unknown-request');
    if (action !== 'inspect') {
      if (row.state !== 'pending') throw new Error('already-decided');
      row.state = action === 'approve' ? 'approved' : 'denied';
    }
    return publicRow(row);
  }
  clear() { this.rows.clear(); }
}
