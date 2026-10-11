import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('updater', Path(__file__).resolve().parents[1] / 'deploy/update-proxies.py')
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)

node = lambda name, server='a.example', port=443: {'name': name, 'type': 'vless', 'server': server, 'port': port, 'uuid': 'secret'}
flags = ['🇭🇰', '🇯🇵', '🇺🇸', '🇸🇬', '🇬🇧', '🇰🇷']


class UpdateTest(unittest.TestCase):
    def test_notices_duplicates_and_malformed_entries_are_dropped(self):
        listed = [node('剩余流量：241 GB'), node('官网： example.com'), node('🇭🇰 香港 1'), node('🇭🇰 香港 1', 'b.example'),
                  node('注意：以下为高倍率节点'), node('🇯🇵 日本'), {'name': '🇺🇸 no server', 'type': 'vless', 'port': 1},
                  'text', None, node('🇸🇬' + 'x' * 80), node('US plain')]
        self.assertEqual([item['name'] for item in updater.real_nodes(listed)], ['🇭🇰 香港 1', '🇯🇵 日本'])
        self.assertEqual(updater.real_nodes(None), [])

    def test_only_nodes_and_group_membership_change(self):
        config = {'mixed-port': 7890, 'rules': ['MATCH,DIRECT'], 'proxies': [node('old-1'), node('old-2')],
                  'proxy-groups': [{'name': 'AUTO', 'type': 'url-test', 'interval': 300, 'lazy': False, 'proxies': ['old-1', 'old-2']}]}
        nodes = [node(f'{flag} {index}', f'{index}.example') for index, flag in enumerate(flags)]
        result = updater.merged(config, nodes)
        self.assertEqual(result['proxies'], nodes)
        self.assertEqual(result['proxy-groups'], [{'name': 'AUTO', 'type': 'url-test', 'interval': 300, 'lazy': False, 'proxies': [item['name'] for item in nodes]}])
        self.assertEqual((result['mixed-port'], result['rules']), (7890, ['MATCH,DIRECT']))
        self.assertEqual(config['proxies'], [node('old-1'), node('old-2')])
        self.assertEqual(config['proxy-groups'][0]['proxies'], ['old-1', 'old-2'])

    def test_a_thin_subscription_never_replaces_working_nodes(self):
        config = {'proxies': [node('old')], 'proxy-groups': []}
        with self.assertRaises(ValueError):
            updater.merged(config, [node(f'{flag} x') for flag in flags[:4]])

    def test_summary_counts_endpoints_without_naming_them(self):
        text = updater.summary([node('a', 'one'), node('b', 'two')], [node('c', 'two'), node('d', 'three'), node('e', 'four')])
        self.assertEqual(text, '2 -> 3 nodes; endpoints kept 1, removed 1, added 2')
        self.assertNotIn('secret', text)


if __name__ == '__main__':
    unittest.main()
