"""Bounded numeric monitoring history. Uses Python's standard SQLite library."""
import math
import os
import sqlite3

METRICS = ('cpu', 'memory', 'rx', 'tx')

def value(number):
    return float(number) if isinstance(number, (int, float)) and not isinstance(number, bool) and math.isfinite(number) and number >= 0 else None

def record(filename, timestamp, server):
    server = server or {}
    memory = server.get('memory') or {}
    network = server.get('network') or {}
    used, total = value(memory.get('used')), value(memory.get('total'))
    values = [value(server.get('cpuPercent')), used / total * 100 if used is not None and total else None, value(network.get('rxBytesPerSecond')), value(network.get('txBytesPerSecond'))]
    new = not filename.exists()
    db = sqlite3.connect(filename, timeout=2)
    try:
        if new:
            db.execute('PRAGMA auto_vacuum=INCREMENTAL')
            os.chmod(filename, 0o644)
        db.execute('PRAGMA journal_mode=DELETE')
        db.execute('CREATE TABLE IF NOT EXISTS samples (t INTEGER PRIMARY KEY, cpu REAL, memory REAL, rx REAL, tx REAL)')
        columns = ', '.join(f'{m}_{suffix} REAL NOT NULL' for m in METRICS for suffix in ('sum', 'count', 'min', 'max'))
        db.execute(f'CREATE TABLE IF NOT EXISTS buckets (t INTEGER PRIMARY KEY, first INTEGER, last INTEGER, gap INTEGER, n INTEGER, {columns})')
        with db:
            previous = db.execute('SELECT MAX(t) FROM samples').fetchone()[0]
            # Ignore duplicate and backwards wall-clock samples; never rewrite history.
            if previous is not None and timestamp <= previous:
                return
            db.execute('INSERT INTO samples VALUES (?,?,?,?,?)', [timestamp, *values])
            bucket = timestamp // 1800 * 1800
            row = db.execute('SELECT * FROM buckets WHERE t=?', (bucket,)).fetchone()
            if row:
                fields = list(row)
                fields[2] = timestamp
                fields[3] = int(bool(fields[3] or timestamp - row[2] > 90 or any(v is None for v in values)))
                fields[4] += 1
                for i, v in enumerate(values):
                    if v is None: continue
                    k = 5 + i * 4
                    fields[k:k+4] = [fields[k] + v, fields[k+1] + 1, min(fields[k+2], v) if fields[k+1] else v, max(fields[k+3], v)]
            else:
                fields = [bucket, timestamp, timestamp, int(any(v is None for v in values) or previous is not None and timestamp - previous > 90), 1]
                for v in values: fields.extend([v or 0, int(v is not None), v or 0, v or 0])
            db.execute(f'INSERT OR REPLACE INTO buckets VALUES ({",".join("?" for _ in fields)})', fields)
            db.execute('DELETE FROM samples WHERE t < ?', (timestamp - 86400,))
            db.execute('DELETE FROM buckets WHERE t < ?', (timestamp - 7 * 86400,))
        db.execute('PRAGMA incremental_vacuum(8)')
    finally:
        db.close()


def rates(current, previous, monotonic, boot):
    """No traffic spikes after restart, interface changes, long gaps or reset counters."""
    unavailable = {'rxBytesPerSecond': None, 'txBytesPerSecond': None}
    if not previous or previous.get('boot') != boot or set(previous.get('interfaces', {})) != set(current): return unavailable
    elapsed = monotonic - previous.get('at', monotonic)
    if not 0 < elapsed <= 90: return unavailable
    delta = [0, 0]
    for name, counters in current.items():
        old = previous['interfaces'][name]
        for index in range(2):
            if counters[index] < old[index]: return unavailable
            delta[index] += counters[index] - old[index]
    return {'rxBytesPerSecond': delta[0] / elapsed, 'txBytesPerSecond': delta[1] / elapsed} if current else unavailable
