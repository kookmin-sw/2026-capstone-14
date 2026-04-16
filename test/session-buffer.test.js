const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSessionBuffer() {
  const filePath = path.join(__dirname, '..', 'public', 'js', 'workout', 'session-buffer.js');
  const source = fs.readFileSync(filePath, 'utf8');
  const context = {
    window: {},
    console: { log() {}, error() {} },
    Date,
    Math,
    Number,
    String,
    Array,
    Object,
    Set,
    Map,
    JSON
  };

  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.SessionBuffer;
}

test('generateInterimSnapshots includes metric breakdown for sampled points', () => {
  const SessionBuffer = loadSessionBuffer();
  const buffer = new SessionBuffer('session-1', { selectedView: 'FRONT' });

  buffer.scoreTimeline = [
    {
      timestamp: 1000,
      score: 82,
      breakdown: [
        {
          key: 'depth',
          title: '깊이',
          score: 82,
          rawValue: 41,
          maxScore: 100,
          feedback: 'good'
        }
      ]
    }
  ];

  const snapshots = JSON.parse(JSON.stringify(buffer.generateInterimSnapshots()));

  assert.deepEqual(snapshots, [
    {
      timestamp_ms: 1000,
      score: 82,
      breakdown: [
        {
          metric_key: 'depth',
          metric_name: '깊이',
          avg_score: 82,
          avg_raw_value: 41,
          min_raw_value: 41,
          max_raw_value: 41,
          sample_count: 1
        }
      ]
    }
  ]);
});
