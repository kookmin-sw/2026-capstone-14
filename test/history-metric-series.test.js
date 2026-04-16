const test = require('node:test');
const assert = require('node:assert/strict');

const dbModulePath = require.resolve('../config/db');
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: { supabase: {} }
};

const historyController = require('../controllers/history');

test('buildMetricSeries groups interim and final metrics by metric key', () => {
  assert.equal(typeof historyController.__test?.buildMetricSeries, 'function');

  const series = historyController.__test.buildMetricSeries({
    startedAt: '2026-04-16T10:00:00.000Z',
    snapshots: [
      { session_snapshot_id: 11, snapshot_no: 1, snapshot_type: 'INTERIM', recorded_at: '2026-04-16T10:00:05.000Z' },
      { session_snapshot_id: 12, snapshot_no: 2, snapshot_type: 'FINAL', recorded_at: '2026-04-16T10:00:09.000Z' }
    ],
    metricRows: [
      { session_snapshot_id: 11, metric_key: 'depth', metric_name: '깊이', avg_score: 42, avg_raw_value: 41, sample_count: 3 },
      { session_snapshot_id: 12, metric_key: 'depth', metric_name: '깊이', avg_score: 75, avg_raw_value: 48, sample_count: 6 }
    ]
  });

  assert.deepEqual(series, [
    {
      metric_key: 'depth',
      metric_name: '깊이',
      points: [
        {
          snapshot_no: 1,
          snapshot_type: 'INTERIM',
          recorded_at: '2026-04-16T10:00:05.000Z',
          t_sec: 5,
          avg_score: 42,
          avg_raw_value: 41,
          min_raw_value: null,
          max_raw_value: null,
          sample_count: 3
        },
        {
          snapshot_no: 2,
          snapshot_type: 'FINAL',
          recorded_at: '2026-04-16T10:00:09.000Z',
          t_sec: 9,
          avg_score: 75,
          avg_raw_value: 48,
          min_raw_value: null,
          max_raw_value: null,
          sample_count: 6
        }
      ]
    }
  ]);
});

test('buildMetricSeries returns empty array when no metric rows exist', () => {
  assert.equal(typeof historyController.__test?.buildMetricSeries, 'function');

  const series = historyController.__test.buildMetricSeries({
    startedAt: '2026-04-16T10:00:00.000Z',
    snapshots: [
      { session_snapshot_id: 11, snapshot_no: 1, snapshot_type: 'INTERIM', recorded_at: '2026-04-16T10:00:05.000Z' }
    ],
    metricRows: []
  });

  assert.deepEqual(series, []);
});
