import importlib.util
import sqlite3
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('history', Path(__file__).resolve().parents[1] / 'deploy/status-history.py')
history = importlib.util.module_from_spec(spec)
spec.loader.exec_module(history)

class HistoryTests(unittest.TestCase):
    def test_retention_peaks_duplicates_and_gaps(self):
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / 'history.sqlite'
            start = 1800000000
            def sample(cpu=10): return {'cpuPercent': cpu, 'memory': {'used': 40, 'total': 100}, 'network': {'rxBytesPerSecond': 1024, 'txBytesPerSecond': 512}}
            history.record(filename, start, sample())
            history.record(filename, start + 30, sample(95))
            history.record(filename, start + 30, sample(1))
            history.record(filename, start + 150, sample(20))
            with sqlite3.connect(filename) as db:
                row = db.execute('SELECT n,cpu_sum,cpu_max,gap FROM buckets').fetchone()
                self.assertEqual(row, (3, 125, 95, 1))
            history.record(filename, start + 86430, sample())
            with sqlite3.connect(filename) as db:
                self.assertEqual(db.execute('SELECT MIN(t) FROM samples').fetchone()[0], start + 30)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM buckets').fetchone()[0], 2)
            history.record(filename, start + 9 * 86400, None)
            with sqlite3.connect(filename) as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM samples').fetchone()[0], 1)
                self.assertEqual(db.execute('SELECT COUNT(*) FROM buckets').fetchone()[0], 1)
                self.assertIsNone(db.execute('SELECT cpu FROM samples').fetchone()[0])
            self.assertEqual(filename.stat().st_mode & 0o777, 0o644)

    def test_network_restart_reset_gaps_and_interface_changes(self):
        previous = {'interfaces': {'eth0': [1000, 500]}, 'boot': 'a', 'at': 10}
        self.assertEqual(history.rates({'eth0': [4000, 2000]}, previous, 40, 'a'), {'rxBytesPerSecond': 100, 'txBytesPerSecond': 50})
        for current, at, boot in [({'eth0': [1, 2000]}, 40, 'a'), ({'eth1': [4000, 2000]}, 40, 'a'), ({'eth0': [4000, 2000]}, 200, 'a'), ({'eth0': [4000, 2000]}, 40, 'b')]:
            self.assertIsNone(history.rates(current, previous, at, boot)['rxBytesPerSecond'])

if __name__ == '__main__': unittest.main()
