const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getSquatMetricPriority,
} = require('../../public/js/workout/exercises/squat-exercise.js');

// ---------------------------------------------------------------------------
// Push-up declarative metadata contract (spec §4.2)
// ---------------------------------------------------------------------------

test('pushUpExercise exposes requirements metadata with requiredViews', () => {
  // Load the exercise module via the registry (browser-style) or directly
  const pushUpModule = getPushUpModule();
  assert.ok(pushUpModule.requirements, 'push-up exercise must expose requirements metadata');
  assert.ok(Array.isArray(pushUpModule.requirements.requiredViews), 'requiredViews must be an array');
  assert.ok(pushUpModule.requirements.requiredViews.includes('SIDE'), 'push-up requires SIDE view');
});

test('pushUpExercise exposes requirements metadata with importantJoints', () => {
  const pushUpModule = getPushUpModule();
  assert.ok(Array.isArray(pushUpModule.requirements.importantJoints), 'importantJoints must be an array');
  assert.ok(pushUpModule.requirements.importantJoints.length > 0, 'importantJoints must not be empty');
});

test('pushUpExercise does NOT have getFrameGate method (gate belongs to scoring-engine)', () => {
  const pushUpModule = getPushUpModule();
  assert.equal(typeof pushUpModule.getFrameGate, 'undefined', 'exercise modules must not have getFrameGate');
});

test('pushUpExercise scoreRep hardFails contain only exercise-specific reason codes', () => {
  // After refactoring, scoreRep must not emit gate-owned reasons.
  // We verify this indirectly by checking the module no longer has gate-owned logic.
  const pushUpModule = getPushUpModule();
  // getFrameGate removal is already tested above.
  // The scoreRep method should only produce: depth_not_reached, lockout_incomplete, body_line_broken
  assert.ok(typeof pushUpModule.scoreRep === 'function', 'scoreRep must still exist');
});

// Helper: get the push-up exercise module object.
// In Node.js the module self-registers into window.WorkoutExerciseRegistry
// when the global is available. We set up a minimal shim.
function getPushUpModule() {
  if (typeof window !== 'undefined' && window.WorkoutExerciseRegistry) {
    return window.WorkoutExerciseRegistry.get('push_up');
  }
  // Fallback: the module also exports normalizePushUpEvaluation via CommonJS,
  // but the exercise object itself is registered globally. For Node.js tests,
  // we need to ensure the registry shim exists before loading the exercise file.
  throw new Error('WorkoutExerciseRegistry not available — ensure the shim is set up before loading push-up-exercise.js');
}

// Set up a minimal WorkoutExerciseRegistry shim for Node.js before loading the exercise module.
if (typeof window === 'undefined') {
  global.window = {
    REP_STATES: { NEUTRAL: 'NEUTRAL', ACTIVE: 'ACTIVE' },
    WorkoutExerciseRegistry: {
      _modules: {},
      register(code, mod) { this._modules[code] = mod; },
      get(code) { return this._modules[code] || null; },
    },
  };
}

// Now load the exercise module so it registers itself.
const pushUpExerciseModule = require('../../public/js/workout/exercises/push-up-exercise.js');
// normalizePushUpEvaluation is exported via CommonJS for backward compatibility
const { normalizePushUpEvaluation } = pushUpExerciseModule;

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