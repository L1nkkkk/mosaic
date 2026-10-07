import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';

const string = (value, limit = 160) => typeof value === 'string' ? value.slice(0, limit) : null;
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const list = value => Array.isArray(value) ? value.slice(0, 100) : [];

// The web container only reads the allowlisted snapshot; no proxy credentials or controller access.
export async function readProxies(filename) {
  const unavailable = { available: false, stale: true, collectedAt: null, groups: [], nodes: [] };
  if (!filename) return unavailable;
  try {
    const raw = await readFile(filename, 'utf8');
    if (raw.length > 256 * 1024) return unavailable;
    const data = JSON.parse(raw);
    const collectedAt = time(data.collectedAt);
    if (data.schemaVersion !== 1 || !collectedAt || !Array.isArray(data.nodes)) return unavailable;
    const expired = at => !at || Date.now() - Date.parse(at) > 20 * 60_000 || Date.parse(at) > Date.now() + 10_000;
    return {
      available: true, stale: expired(collectedAt), collectedAt,
      groups: list(data.groups).filter(item => item && typeof item.name === 'string').map(item => ({ name: string(item.name, 80), selected: string(item.selected, 80) })),
      nodes: list(data.nodes).filter(item => item && typeof item.name === 'string').map(item => {
        const delayAt = time(item.delayAt);
        return {
          name: string(item.name, 80), reachable: typeof item.reachable === 'boolean' ? item.reachable : null,
          checkedAt: time(item.checkedAt), ip: typeof item.ip === 'string' && isIP(item.ip) ? item.ip : null,
          country: string(item.country), countryCode: /^[A-Z]{2}$/.test(item.countryCode) ? item.countryCode : null,
          region: string(item.region), city: string(item.city), isp: string(item.isp),
          delayMs: expired(delayAt) || !number(item.delayMs) ? null : number(item.delayMs), delayAt,
          firstSeen: time(item.firstSeen), lastSeen: time(item.lastSeen), stableSince: time(item.stableSince),
          samples: number(item.samples), changes: number(item.changes),
        };
      }),
    };
  } catch { return unavailable; }
}
