import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import path from 'node:path';
import { externalJson } from './external.js';
const date = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);

export class Visitors {
  constructor(directory, secret, fetcher) {
    this.secret = secret; this.fetcher = fetcher; this.geo = new Map(); this.pending = new Set();
    this.db = new DatabaseSync(path.join(directory, 'visitors.sqlite'));
    this.db.exec(`PRAGMA auto_vacuum=INCREMENTAL; PRAGMA busy_timeout=250;
      CREATE TABLE IF NOT EXISTS totals(id INTEGER PRIMARY KEY CHECK(id=1),views INTEGER,started TEXT);
      INSERT OR IGNORE INTO totals VALUES(1,0,NULL);
      CREATE TABLE IF NOT EXISTS days(day TEXT PRIMARY KEY,views INTEGER,visitors INTEGER,lookups INTEGER);
      CREATE TABLE IF NOT EXISTS seen(key TEXT PRIMARY KEY,day TEXT,last INTEGER);
      CREATE TABLE IF NOT EXISTS regions(day TEXT,code TEXT,n INTEGER,PRIMARY KEY(day,code));`);
  }
  hash(value) { return createHmac('sha256', this.secret).update(value).digest('hex'); }
  async country(ip, day) {
    const key = this.hash(ip), cached = this.geo.get(key);
    if (cached && Date.now() - cached.at < 86400000) return cached.code;
    const row = this.db.prepare('SELECT lookups FROM days WHERE day=?').get(day);
    if (!row || row.lookups >= 900 || this.pending.size >= 4) return 'ZZ';
    this.db.prepare('UPDATE days SET lookups=lookups+1 WHERE day=?').run(day);
    const token = {}; this.pending.add(token);
    try {
      const result = await externalJson(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code`, this.fetcher);
      const code = result.success && /^[A-Z]{2}$/.test(result.country_code) ? result.country_code : 'ZZ';
      if (this.geo.size >= 1000) this.geo.delete(this.geo.keys().next().value);
      this.geo.set(key, { code, at: Date.now() }); return code;
    } catch { return 'ZZ'; }
    finally { this.pending.delete(token); }
  }
  async record(ip, agent, now = Date.now()) {
    if (!isIP(ip)) return;
    const day = date(now), key = this.hash(`${day}|${ip}|${agent.slice(0, 256)}`);
    const previous = this.db.prepare('SELECT last FROM seen WHERE key=?').get(key);
    if (previous && now - previous.last < 30000) return;
    const isNew = !previous;
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM seen WHERE day<>?').run(day);
      const cutoff = date(now - 89 * 86400000);
      this.db.prepare('DELETE FROM days WHERE day<?').run(cutoff); this.db.prepare('DELETE FROM regions WHERE day<?').run(cutoff);
      // Keep collection bounded even if the public endpoint is flooded.
      const count = this.db.prepare('SELECT COUNT(*) AS n FROM seen').get().n;
      if (isNew && count >= 10000) { this.db.exec('ROLLBACK'); return; }
      this.db.prepare('INSERT INTO days VALUES(?,1,?,0) ON CONFLICT(day) DO UPDATE SET views=views+1,visitors=visitors+excluded.visitors').run(day, Number(isNew));
      this.db.prepare('UPDATE totals SET views=views+1,started=COALESCE(started,?) WHERE id=1').run(day);
      this.db.prepare('INSERT INTO seen VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET last=excluded.last').run(key, day, now);
      if (isNew) this.db.prepare("INSERT INTO regions VALUES(?,'ZZ',1) ON CONFLICT(day,code) DO UPDATE SET n=n+1").run(day);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    if (!isNew || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|::1$|f[cd]|fe80)/i.test(ip)) return;
    const code = await this.country(ip, day);
    if (code !== 'ZZ' && !this.closed) {
      this.db.exec('BEGIN IMMEDIATE');
      try {
        this.db.prepare("UPDATE regions SET n=n-1 WHERE day=? AND code='ZZ' AND n>0").run(day);
        this.db.prepare('INSERT INTO regions VALUES(?,?,1) ON CONFLICT(day,code) DO UPDATE SET n=n+1').run(day, code);
        this.db.exec('COMMIT');
      } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    }
  }
  read(now = Date.now()) {
    const day = date(now);
    this.db.prepare('DELETE FROM seen WHERE day<>?').run(day);
    const cutoff90 = date(now - 89 * 86400000);
    this.db.prepare('DELETE FROM days WHERE day<?').run(cutoff90);
    this.db.prepare('DELETE FROM regions WHERE day<?').run(cutoff90);
    const today = this.db.prepare('SELECT views,visitors FROM days WHERE day=?').get(day) || { views: 0, visitors: 0 };
    const totals = this.db.prepare('SELECT views,started FROM totals WHERE id=1').get();
    const cutoff = date(now - 29 * 86400000);
    return { day, today, totalViews: totals.views, started: totals.started, regionDays: 30, regions: this.db.prepare('SELECT code,SUM(n) AS visitors FROM regions WHERE day>=? GROUP BY code HAVING SUM(n)>0 ORDER BY visitors DESC LIMIT 200').all(cutoff) };
  }
  close() { this.closed = true; this.db.close(); }
}
