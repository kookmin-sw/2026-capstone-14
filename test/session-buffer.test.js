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

test('generateInterimSnapshots normalizes raw metric scores to 100 scale', () => {
  const SessionBuffer = loadSessionBuffer();
  const buffer = new SessionBuffer('session-2', { selectedView: 'SIDE' });

  buffer.scoreTimeline = [
    {
      timestamp: 1000,
      score: 82,
      breakdown: [
        {
          key: 'depth',
          title: '깊이',
          score: 24,
          maxScore: 30,
          rawValue: 41,
          feedback: 'deeper'
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
          avg_score: 80,
          avg_raw_value: 41,
          min_raw_value: 41,
          max_raw_value: 41,
          sample_count: 1
        }
      ]
    }
  ]);
});

test('export includes withhold counts and rep-level scoring states', () => {
  const SessionBuffer = loadSessionBuffer();
  const buffer = new SessionBuffer('session-1');

  buffer.recordEvent({
    type: 'withhold',
    timestamp: 1000,
    gate_result: 'withhold',
    withhold_reason: 'view_mismatch',
    estimated_view: 'FRONT',
    estimated_view_confidence: 0.42,
    stable_frame_count: 3,
  });

  buffer.recordRepResult({
    rep_index: 1,
    rep_result: 'soft_fail',
    rep_score: 68,
    hard_fail_reason: null,
    soft_fail_reasons: ['depth_not_reached'],
    score_cap_applied: 70,
    quality_summary: { estimated_view: 'SIDE' },
  });

  const exported = buffer.export();

  assert.equal(exported.withhold_count, 1);
  assert.equal(exported.withhold_reason_counts.view_mismatch, 1);
  assert.equal(exported.rep_results[0].rep_result, 'soft_fail');
});

test('addEvent preserves a payload while keeping legacy type-only calls working', () => {
  const SessionBuffer = loadSessionBuffer();
  const buffer = new SessionBuffer('session-voice');

  buffer.addEvent('SESSION_START');
  buffer.addEvent('LOW_SCORE_HINT', {
    message: '무릎을 바깥쪽으로 밀어주세요',
    metric_key: 'knee_valgus',
    delivery: { visual: true, voice: true },
  });

  assert.equal(buffer.events.length, 2);
  assert.equal(buffer.events[0].type, 'SESSION_START');
  assert.equal(typeof buffer.events[0].timestamp, 'number');
  assert.equal(buffer.events[1].payload.message, '무릎을 바깥쪽으로 밀어주세요');
  assert.equal(buffer.events[1].payload.metric_key, 'knee_valgus');
  assert.equal(buffer.events[1].payload.delivery.visual, true);
  assert.equal(buffer.events[1].payload.delivery.voice, true);
});

test('recordEvent adds a relative timestamp when feedback event has none', () => {
  const SessionBuffer = loadSessionBuffer();
  const buffer = new SessionBuffer('session-voice');

  buffer.recordEvent({
    type: 'REP_COMPLETE_FEEDBACK',
    message: '3회 좋아요',
    exercise_code: 'squat',
    delivery: { visual: true, voice: true },
  });

  const exported = buffer.export();
  assert.equal(exported.events[0].type, 'REP_COMPLETE_FEEDBACK');
  assert.equal(exported.events[0].message, '3회 좋아요');
  assert.equal(typeof exported.events[0].timestamp, 'number');
  assert.equal(exported.events[0].delivery.visual, true);
  assert.equal(exported.events[0].delivery.voice, true);
});
