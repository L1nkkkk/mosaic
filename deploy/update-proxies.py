#!/usr/bin/env python3
"""Refresh the Mihomo node list from a subscription; keep the previous config on any doubt."""
import argparse
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

MIN_NODES = 5
KEEP_BACKUPS = 5


def real_nodes(proxies):
    """Providers pad the list with notices such as remaining traffic; real nodes start with a flag."""
    seen, nodes = set(), []
    for proxy in proxies if isinstance(proxies, list) else []:
        if not isinstance(proxy, dict):
            continue
        name = proxy.get('name')
        if not isinstance(name, str) or len(name) > 80 or name in seen:
            continue
        if not (len(name) >= 2 and all(0x1F1E6 <= ord(char) <= 0x1F1FF for char in name[:2])):
            continue
        if not proxy.get('server') or not proxy.get('port') or not proxy.get('type'):
            continue
        seen.add(name)
        nodes.append(proxy)
    return nodes


def merged(config, nodes):
    """Only the node list and group membership change; ports, rules and group settings stay."""
    if len(nodes) < MIN_NODES:
        raise ValueError('Too few nodes in the subscription')
    names = [node['name'] for node in nodes]
    return dict(config, proxies=nodes, **{'proxy-groups': [dict(group, proxies=names) for group in config['proxy-groups']]})


def summary(old, new):
    endpoint = lambda node: (node.get('server'), node.get('port'))
    before, after = {endpoint(node) for node in old}, {endpoint(node) for node in new}
    return f'{len(old)} -> {len(new)} nodes; endpoints kept {len(before & after)}, removed {len(before - after)}, added {len(after - before)}'


def fetch(url, attempts=3):
    import yaml  # Imported here so the pure functions above stay testable without PyYAML.
    for attempt in range(attempts):
        try:
            raw = subprocess.check_output(['curl', '--silent', '--show-error', '--fail', '--globoff', '--max-time', '40',
                '--max-filesize', '2097152', '--user-agent', 'clash.meta', url], stderr=subprocess.DEVNULL, timeout=45)
            data = yaml.safe_load(raw)
            if isinstance(data, dict) and isinstance(data.get('proxies'), list):
                return data['proxies']
        except Exception:
            pass
        if attempt < attempts - 1:
            time.sleep(10)
    raise RuntimeError('Subscription unavailable')


def write_private(filename, value, owner):
    fd, name = tempfile.mkstemp(prefix='.config-', dir=filename.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            os.fchmod(output.fileno(), 0o600)
            os.fchown(output.fileno(), owner.st_uid, owner.st_gid)
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, filename)
    finally:
        Path(name).unlink(missing_ok=True)


def live_names(container):
    data = json.loads(subprocess.check_output(['docker', 'exec', container, 'wget', '-q', '-T', '5', '-O', '-',
        'http://127.0.0.1:9090/proxies'], stderr=subprocess.DEVNULL, timeout=10))
    return set(data['proxies'])


def reload(container, expected):
    """SIGHUP reloads the config in place; a restart is the fallback if the nodes do not appear."""
    for command in (['docker', 'kill', '--signal', 'HUP', container], ['docker', 'restart', '--time', '10', container]):
        subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=60, check=True)
        for _ in range(20):
            time.sleep(1)
            try:
                if expected <= live_names(container):
                    return
            except Exception:
                pass
    raise RuntimeError('Mihomo did not load the new nodes')


def update(args):
    config_file = Path(args.config)
    with (config_file.parent / '.subscription.lock').open('w') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return
        config = json.loads(config_file.read_text())
        nodes = real_nodes(fetch(Path(args.url_file).read_text().strip()))
        candidate = merged(config, nodes)
        if candidate['proxies'] == config['proxies']:
            print('Subscription unchanged.')
            return
        with tempfile.TemporaryDirectory(prefix='mihomo-candidate-') as scratch:
            trial = Path(scratch) / 'config.json'
            # Mihomo reads the file as YAML, which rejects JSON's escaped surrogate pairs for emoji names.
            trial.write_text(json.dumps(candidate, ensure_ascii=False), encoding='utf-8')
            subprocess.run([args.binary, '-t', '-d', scratch, '-f', str(trial)], stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=30, check=True)
        change = summary(config['proxies'], nodes)
        if args.dry_run:
            print(f'Dry run, nothing written: {change}')
            return
        owner = config_file.stat()
        backup = config_file.with_name(f'{config_file.name}.before-subscription-{dt.datetime.now(dt.timezone.utc):%Y%m%dT%H%M%SZ}')
        shutil.copy2(config_file, backup)
        os.chown(backup, owner.st_uid, owner.st_gid)
        write_private(config_file, candidate, owner)
        try:
            reload(args.container, {node['name'] for node in nodes})
        except Exception:
            # The previous list still had working nodes; put it back rather than leave routing broken.
            write_private(config_file, config, owner)
            try: reload(args.container, {node['name'] for node in config['proxies']})
            except Exception: pass
            raise
        for old in sorted(config_file.parent.glob(f'{config_file.name}.before-subscription-*'))[:-KEEP_BACKUPS]:
            old.unlink()
        print(f'Nodes updated: {change}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', default='/opt/mihomo/state/config.yaml')
    parser.add_argument('--url-file', default='/etc/mihomo-subscription.url')
    parser.add_argument('--binary', default='/opt/mihomo/build/mihomo')
    parser.add_argument('--container', default='mihomo')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    try: update(args)
    except Exception as error:
        # The message names the step only; URLs and node credentials never reach the journal.
        raise SystemExit(f'Node update failed; previous config kept. ({type(error).__name__}: {error if isinstance(error, (ValueError, RuntimeError)) else "see step"})')
