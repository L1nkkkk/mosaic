import { readFile } from 'node:fs/promises';

const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const boolean = value => typeof value === 'boolean' ? value : null;
const usage = value => ({ total: number(value?.total), used: number(value?.used), available: number(value?.available) });
const process = value => ({ running: boolean(value?.running), restarts: number(value?.restarts), uptimeSeconds: number(value?.uptimeSeconds) });

// An explicit allowlist keeps credentials, messages and raw Docker metadata out.
export async function readStatus(filename) {
  const unavailable = { available: false, stale: true, collectedAt: null, server: null, bot: null };
  if (!filename) return unavailable;
  try {
    const raw = await readFile(filename, 'utf8');
    if (raw.length > 64 * 1024) return unavailable;
    const snapshot = JSON.parse(raw);
    const timestamp = Date.parse(snapshot.collectedAt);
    if (snapshot.schemaVersion !== 1 || !Number.isFinite(timestamp)) return unavailable;
    return {
      available: true,
      stale: Date.now() - timestamp > 90_000 || timestamp > Date.now() + 10_000,
      collectedAt: new Date(timestamp).toISOString(),
      server: snapshot.server ? { cpuPercent: number(snapshot.server.cpuPercent), cpuCount: number(snapshot.server.cpuCount), uptimeSeconds: number(snapshot.server.uptimeSeconds), memory: usage(snapshot.server.memory), disk: usage(snapshot.server.disk), network: { rxBytesPerSecond: number(snapshot.server.network?.rxBytesPerSecond), txBytesPerSecond: number(snapshot.server.network?.txBytesPerSecond) } } : null,
      bot: snapshot.bot ? { astrbot: process(snapshot.bot.astrbot), napcat: process(snapshot.bot.napcat), webuiReachable: boolean(snapshot.bot.webuiReachable), onebotConnected: boolean(snapshot.bot.onebotConnected), qqOnline: boolean(snapshot.bot.qqOnline) } : null,
    };
  } catch { return unavailable; }
}
