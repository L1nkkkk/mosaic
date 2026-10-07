#!/usr/bin/env python3
"""Probe real egress through isolated loopback listeners; never change live routing."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import datetime as dt
import fcntl
import hashlib
import ipaddress
import importlib.util
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import tempfile
import time

_spec = importlib.util.spec_from_file_location('mosaic_status', Path(__file__).with_name('collect-status.py'))
_status = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_status)
atomic_json = _status.atomic_json


def now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def read_json(path, default):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return default


def public_ip(value):
    try:
        ip = ipaddress.ip_address(value)
        return str(ip) if ip.is_global else None
    except (ValueError, TypeError):
        return None


def observe(previous, result, at, identity):
    # An updated subscription can reuse names for different nodes; reset its history.
    old = previous if previous.get('identity') == identity else {}
    entry = dict(old, identity=identity)
    ip = result.get('ip')
    if ip:
        changed = bool(old.get('ip') and old['ip'] != ip)
        location = {key: result.get(key) or (old.get(key) if old.get('ip') == ip else None)
                    for key in ('country', 'countryCode', 'region', 'city', 'isp')}
        entry.update(ip=ip, **location,
                     firstSeen=old.get('firstSeen', at), lastSeen=at,
                     stableSince=at if changed else old.get('stableSince', at),
                     samples=old.get('samples', 0) + 1, changes=old.get('changes', 0) + int(changed))
    return entry


def curl_json(proxy, credentials, url):
    raw = subprocess.check_output(['curl', '--silent', '--fail', '--max-time', '10', '--connect-timeout', '5',
        '--max-filesize', '65536', '--proxy', proxy, '--proxy-user', credentials, '--noproxy', '', url],
        stderr=subprocess.DEVNULL, timeout=12)
    return json.loads(raw)


def probe(port, credentials):
    proxy = f'http://127.0.0.1:{port}'
    try:
        data = curl_json(proxy, credentials, 'https://ipwho.is/')
        ip = public_ip(data.get('ip')) if data.get('success') is True else None
        if ip:
            return {'ip': ip, 'country': data.get('country'), 'countryCode': data.get('country_code'),
                    'region': data.get('region'), 'city': data.get('city'), 'isp': data.get('connection', {}).get('isp')}
    except Exception:
        pass
    try:
        data = curl_json(proxy, credentials, 'https://api.ipify.org?format=json')
        return {'ip': public_ip(data.get('ip'))}
    except Exception:
        return {}


def collect(args):
    directory = Path(args.directory)
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / '.proxy-collector.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        config = json.loads(Path(args.config).read_text())
        proxies = config['proxies']
        if not 1 <= len(proxies) <= 100 or len({p['name'] for p in proxies}) != len(proxies):
            raise ValueError('Unsupported node count or duplicate names')
        history = read_json(directory / 'proxy-history.json', {})
        try:
            live = json.loads(subprocess.check_output(['docker', 'exec', 'mihomo', 'wget', '-q', '-T', '5', '-O', '-',
                'http://127.0.0.1:9090/proxies'], stderr=subprocess.DEVNULL, timeout=8))['proxies']
        except Exception:
            live = {}
        groups = [{'name': name, 'selected': value.get('now')} for name, value in live.items()
                  if value.get('all') and name != 'GLOBAL']
        credentials = 'probe:' + secrets.token_hex(24)
        # Reserve unique ports while preparing the config. Auth prevents accidental reuse
        # by another listener from yielding an unrelated IP if a bind fails.
        sockets = []
        ports = []
        for _ in proxies:
            sock = socket.socket(); sock.bind(('127.0.0.1', 0)); sockets.append(sock); ports.append(sock.getsockname()[1])
        isolated = {'mode': 'rule', 'log-level': 'silent', 'ipv6': False, 'proxies': proxies,
                    'rules': ['MATCH,REJECT'], 'listeners': [
                        {'name': f'probe-{i}', 'type': 'mixed', 'listen': '127.0.0.1', 'port': port,
                         'proxy': node['name'], 'users': [{'username': 'probe', 'password': credentials.split(':')[1]}]}
                        for i, (node, port) in enumerate(zip(proxies, ports))]}
        rows = []
        next_history = {}
        with tempfile.TemporaryDirectory(prefix='mosaic-probe-') as scratch:
            filename = Path(scratch) / 'config.json'
            atomic_json(filename, isolated, 0o600)
            subprocess.run([args.binary, '-t', '-d', scratch, '-f', str(filename)], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=10, check=True)
            for sock in sockets: sock.close()
            process = subprocess.Popen([args.binary, '-d', scratch, '-f', str(filename)],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            try:
                for attempt in range(40):
                    if process.poll() is not None: raise RuntimeError('Probe process exited')
                    try:
                        with socket.create_connection(('127.0.0.1', ports[0]), timeout=.1): break
                    except OSError: time.sleep(.1)
                else: raise RuntimeError('Probe listener unavailable')
                with ThreadPoolExecutor(max_workers=4) as pool:
                    results = list(pool.map(lambda port: (probe(port, credentials), now()), ports))
                for node, (result, at) in zip(proxies, results):
                    name = node['name']
                    identity = hashlib.sha256(json.dumps(node, sort_keys=True).encode()).hexdigest()
                    entry = observe(history.get(name, {}), result, at, identity)
                    next_history[name] = entry
                    recent = (live.get(name, {}).get('history') or [{}])[-1]
                    rows.append({k: entry.get(k) for k in ['ip', 'country', 'countryCode', 'region', 'city', 'isp',
                        'firstSeen', 'lastSeen', 'stableSince', 'samples', 'changes']} | {
                        'name': name, 'reachable': bool(result.get('ip')), 'checkedAt': at,
                        'delayMs': recent.get('delay') or None, 'delayAt': recent.get('time'),
                    })
            finally:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait()
        atomic_json(directory / 'proxy-history.json', next_history, 0o600)
        atomic_json(directory / 'proxies.json', {'schemaVersion': 1, 'collectedAt': now(), 'groups': groups, 'nodes': rows})
        print(f'Collected {len(rows)} nodes; {sum(row["reachable"] for row in rows)} egress checks succeeded.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--directory', default='/var/lib/mosaic/monitor')
    parser.add_argument('--config', default='/opt/mihomo/state/config.yaml')
    parser.add_argument('--binary', default='/opt/mihomo/build/mihomo')
    args = parser.parse_args()
    try: collect(args)
    except Exception:
        # Keep the last snapshot; readers explicitly mark it stale. No raw secrets in logs.
        raise SystemExit('Proxy collection failed; retained previous snapshot.')
