import importlib.util
from pathlib import Path
import tempfile
import time
import unittest

spec = importlib.util.spec_from_file_location('collector', Path(__file__).resolve().parents[1] / 'deploy/collect-proxies.py')
collector = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collector)


class HistoryTest(unittest.TestCase):
    def test_observation_change_failure_and_reused_name(self):
        first = collector.observe({}, {'ip': '8.8.8.8', 'country': 'US'}, '2026-01-01', 'nodeA')
        second = collector.observe(first, {'ip': '8.8.8.8'}, '2026-01-02', 'nodeA')
        self.assertEqual(second['samples'], 2)
        self.assertEqual(second['changes'], 0)
        self.assertEqual(second['country'], 'US')
        failed = collector.observe(second, {}, '2026-01-03', 'nodeA')
        self.assertEqual(failed, second)
        changed = collector.observe(failed, {'ip': '1.1.1.1'}, '2026-01-04', 'nodeA')
        self.assertEqual(changed['changes'], 1)
        self.assertEqual(changed['stableSince'], '2026-01-04')
        self.assertIsNone(changed['country'])
        replacement = collector.observe(changed, {'ip': '1.1.1.1'}, '2026-01-05', 'nodeB')
        self.assertEqual(replacement['samples'], 1)
        self.assertEqual(replacement['changes'], 0)
        self.assertEqual(replacement['firstSeen'], '2026-01-05')

    def test_only_public_addresses(self):
        for value in [None, 'bad', '127.0.0.1', '10.0.0.1', '::1']:
            self.assertIsNone(collector.public_ip(value))
        self.assertEqual(collector.public_ip('8.8.8.8'), '8.8.8.8')

    def test_refresh_is_requested_only_when_most_nodes_fail_and_at_most_hourly(self):
        rows = lambda up, down: [{'reachable': True}] * up + [{'reachable': False}] * down
        with tempfile.TemporaryDirectory() as directory:
            flag = Path(directory) / '.refresh-nodes'
            for healthy in [rows(5, 5), rows(8, 2), rows(1, 0), []]:
                self.assertFalse(collector.request_refresh(flag, healthy, time.time()))
            self.assertFalse(flag.exists())
            self.assertTrue(collector.request_refresh(flag, rows(4, 5), time.time()))
            self.assertTrue(flag.exists())
            self.assertFalse(collector.request_refresh(flag, rows(0, 9), time.time() + 3599))
            self.assertTrue(collector.request_refresh(flag, rows(0, 9), time.time() + 3601))


if __name__ == '__main__': unittest.main()
