import test from 'node:test';
import assert from 'node:assert/strict';
import { meta, validate } from '../modules/study/definition.js';
import { parsePlan, readStatus, mergePlan } from '../modules/study/plan.js';

const table = `## 对照清单：你的现状

| 清单项 | 你自己实现过 | 只需要能讲 / 要补的 |
|---|---|---|
| 渲染管线、Early-Z、MVP | ✅ LearnOpenGL 阶段 | Z-Prepass 的取舍 |
| CSM | ❌ | 至少要能讲原理 |
| 渲染方程、BRDF、PBR | ⚠️ 仓库里是 AI 写的 | **必须自己学透**，最好重写直接光照部分 |
| **DDGI** | 🎯 要做 | 你的深度项目 |
| 遮挡剔除、半透明、合批 | 部分（半透明你做过） | 能讲 Hi-Z、Occlusion Query |
| C++、TopK | — | 按八股准备 |

## 学习顺序
1. **GAMES202**：面经里反复推荐，它的实时 GI 章节会把 RSM、SSDO 讲一遍；
2. **DDGI 论文**：Majercik et al. 2019（JCGT）；
3. [RTXGI](https://github.com/NVIDIAGameWorks/RTXGI)：作为写代码时的参考答案。`;

test('a pasted Markdown study table becomes topics and ordered reading', () => {
  const { topics, resources } = parsePlan(table);
  assert.deepEqual(topics, [
    { name: '渲染管线、Early-Z、MVP', level: 3, star: false, note: 'LearnOpenGL 阶段', gap: 'Z-Prepass 的取舍' },
    { name: 'CSM', level: 0, star: false, note: '', gap: '至少要能讲原理' },
    { name: '渲染方程、BRDF、PBR', level: 1, star: false, note: '仓库里是 AI 写的', gap: '必须自己学透，最好重写直接光照部分' },
    { name: 'DDGI', level: 0, star: true, note: '', gap: '你的深度项目' },
    { name: '遮挡剔除、半透明、合批', level: 2, star: false, note: '半透明你做过', gap: '能讲 Hi-Z、Occlusion Query' },
    { name: 'C++、TopK', level: 0, star: false, note: '', gap: '按八股准备' },
  ]);
  assert.deepEqual(resources, [
    { title: 'GAMES202', note: '面经里反复推荐，它的实时 GI 章节会把 RSM、SSDO 讲一遍', url: '' },
    { title: 'DDGI 论文', note: 'Majercik et al. 2019（JCGT）', url: '' },
    { title: 'RTXGI', note: '作为写代码时的参考答案', url: 'https://github.com/NVIDIAGameWorks/RTXGI' },
  ]);
});

test('a table copied from a rendered page arrives tab separated, header first', () => {
  const copied = '清单项\t你自己实现过\t只需要能讲 / 要补的\n渲染管线、Early-Z、MVP\t✅ LearnOpenGL 阶段\tZ-Prepass 的取舍\nTAA 拖影\t❌\t降噪练习里的时域部分正好覆盖\t\n';
  assert.deepEqual(parsePlan(copied).topics.map(topic => [topic.name, topic.level, topic.gap]), [['渲染管线、Early-Z、MVP', 3, 'Z-Prepass 的取舍'], ['TAA 拖影', 0, '降噪练习里的时域部分正好覆盖']]);
  assert.deepEqual(parsePlan('随便写的一段话\n没有表格').topics, []);
});

test('only marks count as a status, so header words are not read as progress', () => {
  assert.equal(readStatus('你自己实现过').known, false);
  assert.deepEqual(readStatus('能讲透'), { level: 4, star: false, note: '', known: true });
  assert.equal(readStatus('AI 写的').level, 1);
});

test('importing again keeps progress and adds only what is new', () => {
  let next = 0;
  const id = () => `id${next++}`;
  const first = validate(mergePlan(meta.defaultData, parsePlan(table), id));
  const progressed = { ...first, topics: first.topics.map(topic => topic.name === 'CSM' ? { ...topic, level: 4 } : topic) };
  const again = mergePlan(progressed, parsePlan(table + '\n| 新主题 | ❌ | 待补 |'), id);
  // A row whose status column has a mark is data even at the start of a table.
  assert.deepEqual(again.topics.map(topic => topic.name).slice(-2), ['C++、TopK', '新主题']);
  assert.equal(again.topics.find(topic => topic.name === 'CSM').level, 4);
  assert.equal(again.resources.length, 3);
  assert.deepEqual(validate(again), again);
});

test('study plans are private and checked field by field', () => {
  assert.equal(meta.privateOnly, true);
  assert.deepEqual(validate(meta.defaultData), meta.defaultData);
  const topic = { id: 'a', name: 'CSM', level: 2, star: true, note: '', gap: '' };
  for (const bad of [{ level: 5 }, { level: 1.5 }, { name: '' }, { id: 'no spaces' }, { gap: 'x'.repeat(301) }])
    assert.throws(() => validate({ title: '', topics: [{ ...topic, ...bad }], resources: [] }), JSON.stringify(bad));
  assert.throws(() => validate({ title: '', topics: [topic], resources: [{ id: 'a', title: '重复编号', note: '', url: '', done: false }] }));
  assert.throws(() => validate({ title: '', topics: [], resources: [{ id: 'r', title: 'x', note: '', url: 'javascript:alert(1)', done: false }] }));
});
