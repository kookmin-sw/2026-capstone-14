const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeLabelPayload,
  labelPhaseDataset,
  buildTrainingExport
} = require('../public/js/workout/phase-dataset-utils.js');

test('normalizeLabelPayload accepts segments and frame labels', () => {
  const normalized = normalizeLabelPayload({
    source: 'qa',
    segments: [
      { startMs: 0, endMs: 100, phase: 'descent' },
      { startMs: 101, endMs: 180, phase: 'bottom' }
    ],
    frames: [
      { frameIndex: 3, phase: 'ascent' }
    ]
  });

  assert.equal(normalized.segments.length, 2);
  assert.equal(normalized.segments[0].phase, 'DESCENT');
  assert.equal(normalized.labels[0].phase, 'ASCENT');
});

test('labelPhaseDataset labels frames from segments and explicit frame overrides', () => {
  const rawDataset = {
    schema_version: 1,
    exercise_code: 'squat',
    feature_frames: [
      { frame_index: 0, timestamp_ms: 0, rule_phase: 'DESCENT' },
      { frame_index: 1, timestamp_ms: 100, rule_phase: 'BOTTOM' },
      { frame_index: 2, timestamp_ms: 200, rule_phase: 'ASCENT' }
    ]
  };

  const merged = labelPhaseDataset(rawDataset, {
    segments: [
      { startMs: 0, endMs: 150, phase: 'DESCENT' }
    ],
    labels: [
      { frameIndex: 2, phase: 'LOCKOUT' }
    ]
  });

  assert.equal(merged.labels[0].phase, 'DESCENT');
  assert.equal(merged.labels[2].phase, 'LOCKOUT');
  assert.equal(merged.summary.labeled_frames, 3);
  assert.equal(merged.samples[2].human_phase, 'LOCKOUT');
});

test('buildTrainingExport produces training-ready samples', () => {
  const exportData = buildTrainingExport({
    schema_version: 1,
    exercise_code: 'squat',
    sample_ms: 200,
    feature_frames: [
      { frame_index: 0, timestamp_ms: 0, rule_phase: 'NEUTRAL' },
      { frame_index: 1, timestamp_ms: 200, rule_phase: 'DESCENT' }
    ]
  }, {
    labels: [
      { frame_index: 1, phase: 'BOTTOM' }
    ]
  });

  assert.equal(exportData.summary.total_frames, 2);
  assert.equal(exportData.summary.labeled_frames, 1);
  assert.equal(exportData.samples[0].human_phase, null);
  assert.equal(exportData.samples[1].human_phase, 'BOTTOM');
});
