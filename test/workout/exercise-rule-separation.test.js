const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getSquatMetricPriority,
} = require('../../public/js/workout/exercises/squat-exercise.js');
const {
  normalizePushUpEvaluation,
} = require('../../public/js/workout/exercises/push-up-exercise.js');

// ---------------------------------------------------------------------------
// Squat view-aware metric priority
// ---------------------------------------------------------------------------

test('getSquatMetricPriority prefers knee alignment for FRONT view', () => {
  const priority = getSquatMetricPriority('FRONT');
  assert.deepEqual(priority.primary, ['knee_alignment']);
  assert.deepEqual(priority.secondary, ['depth']);
});

test('getSquatMetricPriority prioritizes depth and hip hinge for SIDE view', () => {
  const priority = getSquatMetricPriority('SIDE');
  assert.deepEqual(priority.primary, ['depth', 'hip_hinge']);
  assert.deepEqual(priority.secondary, ['torso_stability']);
  assert.equal(priority.disallowedHardFailMetrics.includes('knee_alignment'), true);
});

test('getSquatMetricPriority excludes knee alignment from DIAGONAL hard-fail evaluation', () => {
  const priority = getSquatMetricPriority('DIAGONAL');
  assert.deepEqual(priority.primary, ['depth']);
  assert.deepEqual(priority.secondary, ['torso_stability']);
  assert.equal(priority.disallowedHardFailMetrics.includes('knee_alignment'), true);
});

test('getSquatMetricPriority defaults to DIAGONAL rules for unknown view', () => {
  const priority = getSquatMetricPriority('UNKNOWN');
  assert.equal(priority.disallowedHardFailMetrics.includes('knee_alignment'), true);
});

test('FRONT view disallows hip_hinge from hard-fail', () => {
  const priority = getSquatMetricPriority('FRONT');
  assert.equal(priority.disallowedHardFailMetrics.includes('hip_hinge'), true);
});

test('SIDE view does NOT disallow depth from hard-fail', () => {
  const priority = getSquatMetricPriority('SIDE');
  assert.equal(priority.disallowedHardFailMetrics.includes('depth'), false);
});

// ---------------------------------------------------------------------------
// Push-up normalization – gate-only reasons must not survive as exercise failures
// ---------------------------------------------------------------------------

test('normalizePushUpEvaluation removes low_confidence from hard fail', () => {
  const result = normalizePushUpEvaluation({
    hardFailReason: 'low_confidence',
    softFailReasons: [],
  });

  assert.equal(result.hardFailReason, null);
  assert.deepEqual(result.softFailReasons, []);
});

test('normalizePushUpEvaluation removes view_mismatch from hard fail', () => {
  const result = normalizePushUpEvaluation({
    hardFailReason: 'view_mismatch',
    softFailReasons: [],
  });

  assert.equal(result.hardFailReason, null);
  assert.deepEqual(result.softFailReasons, []);
});

test('normalizePushUpEvaluation filters low_confidence from soft fails', () => {
  const result = normalizePushUpEvaluation({
    hardFailReason: 'depth_not_reached',
    softFailReasons: ['low_confidence', 'body_line_broken'],
  });

  assert.equal(result.hardFailReason, 'depth_not_reached');
  assert.deepEqual(result.softFailReasons, ['body_line_broken']);
});

test('normalizePushUpEvaluation filters view_mismatch from soft fails', () => {
  const result = normalizePushUpEvaluation({
    hardFailReason: null,
    softFailReasons: ['view_mismatch', 'lockout_incomplete'],
  });

  assert.equal(result.hardFailReason, null);
  assert.deepEqual(result.softFailReasons, ['lockout_incomplete']);
});

test('normalizePushUpEvaluation preserves movement-quality hard fails', () => {
  const result = normalizePushUpEvaluation({
    hardFailReason: 'depth_not_reached',
    softFailReasons: ['body_line_broken'],
  });

  assert.equal(result.hardFailReason, 'depth_not_reached');
  assert.deepEqual(result.softFailReasons, ['body_line_broken']);
});

test('normalizePushUpEvaluation returns null hardFailReason when input has no failure', () => {
  const result = normalizePushUpEvaluation({
    hardFailReason: null,
    softFailReasons: [],
  });

  assert.equal(result.hardFailReason, null);
  assert.deepEqual(result.softFailReasons, []);
});

test('normalizePushUpEvaluation returns sensible default for null input', () => {
  const result = normalizePushUpEvaluation(null);

  assert.equal(result.hardFailReason, null);
  assert.deepEqual(result.softFailReasons, []);
});

test('normalizePushUpEvaluation returns sensible default for undefined input', () => {
  const result = normalizePushUpEvaluation(undefined);

  assert.equal(result.hardFailReason, null);
  assert.deepEqual(result.softFailReasons, []);
});

test('normalizePushUpEvaluation handles both low_confidence and view_mismatch in soft fails', () => {
  const result = normalizePushUpEvaluation({
    hardFailReason: null,
    softFailReasons: ['low_confidence', 'view_mismatch', 'depth_not_reached'],
  });

  assert.equal(result.hardFailReason, null);
  assert.deepEqual(result.softFailReasons, ['depth_not_reached']);
});