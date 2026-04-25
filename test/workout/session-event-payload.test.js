const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../../config/db');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: { supabase: {} }
};

const workoutController = require('../../controllers/workout.js');

test('normalizeEvents preserves a safe feedback payload subset', () => {
  assert.equal(typeof workoutController.__test?.normalizeEvents, 'function');

  const rows = workoutController.__test.normalizeEvents(
    [
      {
        type: 'LOW_SCORE_HINT',
        timestamp: 1200,
        message: '무릎을 바깥쪽으로 밀어주세요',
        exercise_code: 'squat',
        metric_key: 'knee_valgus',
        metric_name: '무릎 정렬',
        score: 42,
        max_score: 100,
        normalized_score: 42,
        rep_number: 3,
        set_number: 1,
        severity: 'warning',
        source: 'live_feedback',
        delivery: { visual: true, voice: true },
        ignored_private_value: 'must not be saved',
      },
    ],
    77,
    '2026-04-26T00:00:00.000Z',
  );

  assert.equal(rows.length, 1);
  assert.equal(rows[0].session_id, 77);
  assert.equal(rows[0].type, 'LOW_SCORE_HINT');
  assert.equal(rows[0].event_time, '2026-04-26T00:00:01.200Z');
  assert.deepStrictEqual(rows[0].payload, {
    message: '무릎을 바깥쪽으로 밀어주세요',
    exercise_code: 'squat',
    metric_key: 'knee_valgus',
    metric_name: '무릎 정렬',
    score: 42,
    max_score: 100,
    normalized_score: 42,
    rep_number: 3,
    set_number: 1,
    severity: 'warning',
    source: 'live_feedback',
    delivery: { visual: true, voice: true },
  });
});

test('normalizeEvents trims long feedback messages and supports nested payload', () => {
  const longMessage = '가'.repeat(700);

  const rows = workoutController.__test.normalizeEvents(
    [
      {
        type: 'REP_COMPLETE_FEEDBACK',
        timestamp_ms: 0,
        payload: {
          message: longMessage,
          exercise_code: 'squat',
          delivery: { visual: true, voice: false },
        },
      },
    ],
    88,
    '2026-04-26T00:00:00.000Z',
  );

  assert.equal(rows[0].payload.message.length, 500);
  assert.deepStrictEqual(rows[0].payload.delivery, {
    visual: true,
    voice: false,
  });
});
