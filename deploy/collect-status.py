#!/usr/bin/env python3
"""Publish a small allowlisted snapshot; never export credentials or messages."""
import argparse
import importlib.util
import time
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import tempfile
import urllib.request


def atomic_json(filename, value, mode=0o644):
    fd, name = tempfile.mkstemp(prefix='.status-', dir=filename.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            os.fchmod(output.fileno(), mode)
            json.dump(value, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, filename)
    finally:
        Path(name).unlink(missing_ok=True)


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=8)


def history_module():
    spec = importlib.util.spec_from_file_location('status_history', Path(__file__).with_name('status-history.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def network_status(directory):
    # Only default-route interfaces: exclude Docker bridges, veth and loopback duplication.
    interfaces = {row.split()[0] for row in Path('/proc/net/route').read_text().splitlines()[1:] if row.split()[1] == '00000000' and int(row.split()[3], 16) & 2}
    current = {}
    for row in Path('/proc/net/dev').read_text().splitlines()[2:]:
        name, fields = row.split(':', 1)
        if name.strip() in interfaces:
            fields = fields.split()
            current[name.strip()] = [int(fields[0]), int(fields[8])]
    previous = None
    try: previous = json.loads((directory / 'network-sample.json').read_text())
    except (OSError, ValueError): pass
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    at = time.monotonic()
    result = history_module().rates(current, previous, at, boot)
    atomic_json(directory / 'network-sample.json', {'interfaces': current, 'boot': boot, 'at': at}, 0o600)
    return result


def server_status(directory):
    counters = [int(value) for value in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
    total, idle = sum(counters), counters[3] + counters[4]
    cpu = None
    boot = Path('/proc/sys/kernel/random/boot_id').read_text().strip()
    try:
        previous = json.loads((directory / 'cpu-sample.json').read_text())
        elapsed = total - previous['total']
        if elapsed > 0 and previous.get('boot') == boot:
            cpu = round(max(0, min(100, 100 * (1 - (idle - previous['idle']) / elapsed))), 1)
    except (OSError, ValueError, KeyError):
        pass
    atomic_json(directory / 'cpu-sample.json', {'total': total, 'idle': idle, 'boot': boot}, 0o600)
    memory = {line.split(':')[0]: int(line.split()[1]) * 1024 for line in Path('/proc/meminfo').read_text().splitlines() if line.split(':')[0] in ('MemTotal', 'MemAvailable')}
    disk = shutil.disk_usage('/')
    return {
        'cpuPercent': cpu, 'cpuCount': os.cpu_count(),
        'network': network_status(directory),
        'uptimeSeconds': int(float(Path('/proc/uptime').read_text().split()[0])),
        'memory': {'total': memory['MemTotal'], 'used': memory['MemTotal'] - memory['MemAvailable'], 'available': memory['MemAvailable']},
        'disk': {'total': disk.total, 'used': disk.used, 'available': disk.free},
    }


def container_info(name):
    try:
        return json.loads(command('docker', 'inspect', name))[0]
    except (subprocess.SubprocessError, ValueError, IndexError):
        return None


def process_state(container):
    if not container:
        return {'running': None, 'restarts': None, 'uptimeSeconds': None}
    running = container['State']['Running']
    started = container['State'].get('StartedAt', '')
    try:
        # Docker emits nanoseconds; Python 3.10 accepts up to microseconds.
        started = re.sub(r'(\.\d{6})\d+(?=Z|[+-])', r'\1', started)
        at = datetime.datetime.fromisoformat(started.replace('Z', '+00:00'))
        uptime = max(0, int((datetime.datetime.now(datetime.timezone.utc) - at).total_seconds())) if running else 0
    except ValueError:
        uptime = None
    return {'running': running, 'restarts': container['RestartCount'], 'uptimeSeconds': uptime}


def tcp_reachable(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=2): return True
    except OSError: return False


def bot_status():
    astrbot, napcat = container_info('astrbot'), container_info('napcat')
    result = {'astrbot': process_state(astrbot), 'napcat': process_state(napcat), 'webuiReachable': tcp_reachable(6185), 'onebotConnected': None, 'qqOnline': None}
    if astrbot and astrbot['State']['Running']:
        try:
            probe = "from pathlib import Path; rows=[r.split() for f in ('/proc/net/tcp','/proc/net/tcp6') if Path(f).exists() for r in Path(f).read_text().splitlines()[1:]]; print(int(any(r[1].rsplit(':',1)[-1]=='1837' and r[3]=='01' for r in rows)))"
            result['onebotConnected'] = command('docker', 'exec', 'astrbot', 'python', '-c', probe).strip() == '1'
        except subprocess.SubprocessError: pass
    elif astrbot:
        result['onebotConnected'] = False
    if napcat and napcat['State']['Running']:
        try:
            # The token stays in this host process. Only the resulting boolean is written.
            config_root = Path(next(m['Source'] for m in napcat['Mounts'] if m['Destination'] == '/app/napcat/config'))
            token = json.loads((config_root / 'webui.json').read_text(encoding='utf-8-sig'))['token']
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def request(route, body, credential=None):
                headers = {'Content-Type': 'application/json'}
                if credential: headers['Authorization'] = 'Bearer ' + credential
                req = urllib.request.Request('http://127.0.0.1:6099/api' + route, json.dumps(body).encode(), headers)
                with opener.open(req, timeout=4) as response: return json.load(response)

            credential = request('/auth/login', {'hash': hashlib.sha256((token + '.napcat').encode()).hexdigest()})['data']['Credential']
            status = request('/QQLogin/CheckLoginStatus', {}, credential)['data']
            if isinstance(status.get('isLogin'), bool) and isinstance(status.get('isOffline'), bool):
                result['qqOnline'] = status['isLogin'] and not status['isOffline']
        except Exception:
            # Unknown is distinct from offline; never put raw responses in the snapshot/log.
            pass
    elif napcat:
        result['qqOnline'] = False
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', default='/var/lib/mosaic/monitor')
    args = parser.parse_args()
    directory = Path(args.directory)
    directory.mkdir(parents=True, exist_ok=True, mode=0o755)
    try: server = server_status(directory)
    except Exception: server = None
    collected_at = datetime.datetime.now(datetime.timezone.utc)
    try:
        history_module().record(directory / 'history.sqlite', int(collected_at.timestamp()), server)
    except Exception:
        print('History collection unavailable', flush=True)
    try: bot = bot_status()
    except Exception: bot = None
    snapshot = {'schemaVersion': 1, 'collectedAt': collected_at.isoformat(), 'server': server, 'bot': bot}
    atomic_json(directory / 'status.json', snapshot)


if __name__ == '__main__': main()
