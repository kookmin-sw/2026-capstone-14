const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GATE_ONLY_REASONS,
  evaluateQualityGate,
  applyRepOutcome,
} = require('../../public/js/workout/scoring-engine.js');

// ---------------------------------------------------------------------------
// Authority contract: gate-owned reasons must only come from scoring-engine
// ---------------------------------------------------------------------------

test('GATE_ONLY_REASONS is exported and non-empty', () => {
  assert.ok(Array.isArray(GATE_ONLY_REASONS));
  assert.ok(GATE_ONLY_REASONS.length >= 6);
});

test('evaluateQualityGate only emits gate-owned reason codes or null', () => {
  // Test all withhold paths produce only GATE_ONLY_REASONS
  const testCases = [
    { inputs: { cameraDistanceOk: false, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'out_of_frame' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.3, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'low_confidence' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.3, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'tracked_joints_low' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.5, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'out_of_frame' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.5, minKeyJointVisibility: 0.3, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'joints_missing' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'FRONT', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'view_mismatch' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.5 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'view_unstable' },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 3, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] }, expectedReason: 'view_unstable' },
  ];

  for (const tc of testCases) {
    const result = evaluateQualityGate(tc.inputs, tc.context);
    assert.equal(result.result, 'withhold', `expected withhold for inputs: ${JSON.stringify(tc.inputs)}`);
    assert.equal(result.reason, tc.expectedReason, `expected reason ${tc.expectedReason}, got ${result.reason}`);
    assert.ok(GATE_ONLY_REASONS.includes(result.reason), `reason ${result.reason} must be in GATE_ONLY_REASONS`);
  }
});

test('applyRepOutcome prioritizes gate withhold over any exercise evaluation', () => {
  const result = applyRepOutcome({
    gateResult: 'withhold',
    repState: { active: true },
    exerciseEvaluation: { hardFailReason: 'depth_not_reached', softFailReasons: [] },
  });
  assert.equal(result.repResult, 'withheld');
  assert.equal(result.incrementRepCount, false);
});

test('applyRepOutcome with gate=pass delegates to exercise evaluation for state', () => {
  const result = applyRepOutcome({
    gateResult: 'pass',
    repState: { active: true },
    exerciseEvaluation: { hardFailReason: 'depth_not_reached', softFailReasons: [] },
  });
  assert.equal(result.repResult, 'hard_fail');
  assert.equal(result.incrementRepCount, false);
});

// ---------------------------------------------------------------------------
// Cross-module reason-code integrity (spec §3.1, §3.2)
// ---------------------------------------------------------------------------

const { mapWithholdReasonToMessage } = require('../../public/js/workout/quality-gate-session.js');
const { normalizePushUpEvaluation } = require('../../public/js/workout/exercises/push-up-exercise.js');

test('every GATE_ONLY_REASON maps to a dedicated, non-fallback UX message', () => {
  // Derive the fallback dynamically so the test does not hardcode the UX string.
  const fallbackMessage = mapWithholdReasonToMessage('__unknown_reason__');
  const messages = GATE_ONLY_REASONS.map((r) => mapWithholdReasonToMessage(r));

  // Coverage: every reason must return something other than the fallback.
  const uncovered = GATE_ONLY_REASONS.filter(
    (r) => mapWithholdReasonToMessage(r) === fallbackMessage
  );
  assert.deepEqual(
    uncovered,
    [],
    `all GATE_ONLY_REASONS must be covered in the UI message map; uncovered: ${uncovered.join(', ')}`
  );

  // Distinctness: no two reasons should share the same UX message.
  const uniqueMessages = new Set(messages);
  assert.equal(
    uniqueMessages.size,
    GATE_ONLY_REASONS.length,
    'each GATE_ONLY_REASON must have a distinct UX message'
  );

  // Meaningfulness: every message must be a non-trivial string.
  for (const reason of GATE_ONLY_REASONS) {
    const message = mapWithholdReasonToMessage(reason);
    assert.ok(
      typeof message === 'string' && message.length > 10,
      `UX message for "${reason}" must be a meaningful string`
    );
  }
});

test('GATE_ONLY_REASONS set is exactly the withhold reasons emitted by evaluateQualityGate', () => {
  // Collect every unique reason the gate can emit on withhold paths
  const emittedReasons = new Set();
  const testCases = [
    { inputs: { cameraDistanceOk: false, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] } },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.3, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] } },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.3, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] } },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.5, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] } },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.5, minKeyJointVisibility: 0.3, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] } },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'FRONT', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] } },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 10, unstableFrameRatio: 0.5 }, context: { allowedViews: ['SIDE'] } },
    { inputs: { cameraDistanceOk: true, detectionConfidence: 0.9, trackingConfidence: 0.9, frameInclusionRatio: 0.95, keyJointVisibilityAverage: 0.8, minKeyJointVisibility: 0.7, estimatedView: 'SIDE', estimatedViewConfidence: 0.8, stableFrameCount: 3, unstableFrameRatio: 0.05 }, context: { allowedViews: ['SIDE'] } },
  ];

  for (const tc of testCases) {
    const result = evaluateQualityGate(tc.inputs, tc.context);
    if (result.result === 'withhold') {
      emittedReasons.add(result.reason);
    }
  }

  const canonicalSet = new Set(GATE_ONLY_REASONS);
  assert.deepEqual(
    [...emittedReasons].sort(),
    [...canonicalSet].sort(),
    'emitted withhold reasons must exactly match GATE_ONLY_REASONS'
  );
});

test('push-up exercise hard-fail reasons never overlap with GATE_ONLY_REASONS', () => {
  // Exercise-specific hard-fail reasons (from push-up scoreRep logic)
  const exerciseHardFailReasons = ['depth_not_reached', 'lockout_incomplete', 'body_line_broken'];

  for (const reason of exerciseHardFailReasons) {
    assert.ok(
      !GATE_ONLY_REASONS.includes(reason),
      `exercise hard-fail reason "${reason}" must not be in GATE_ONLY_REASONS`
    );
  }
});

test('normalizePushUpEvaluation strips any gate-owned reasons that leak into exercise output', () => {
  // Simulate a hypothetical leak — normalization should sanitize it
  const leakedEvaluation = {
    hardFailReason: 'low_confidence',
    softFailReasons: ['view_mismatch', 'depth_not_reached'],
  };

  const normalized = normalizePushUpEvaluation(leakedEvaluation);

  assert.equal(
    normalized.hardFailReason,
    null,
    'gate-owned hardFailReason must be stripped'
  );
  assert.ok(
    !normalized.softFailReasons.includes('low_confidence'),
    'gate-owned softFailReason low_confidence must be stripped'
  );
  assert.ok(
    !normalized.softFailReasons.includes('view_mismatch'),
    'gate-owned softFailReason view_mismatch must be stripped'
  );
  assert.ok(
    normalized.softFailReasons.includes('depth_not_reached'),
    'exercise-owned softFailReason depth_not_reached must be preserved'
  );
});



// ---------------------------------------------------------------------------
// pose-engine.js signal purity (spec §3.4)
// ---------------------------------------------------------------------------

test('pose-engine exports do not include any gating functions', () => {
  const poseModule = require('../../public/js/workout/pose-engine.js');
  const exportedKeys = Object.keys(poseModule);

  // pose-engine should export PoseEngine class and buildQualityGateInputs helper
  // It must NOT export any function with "gate" or "withhold" in the name
  const gateLikeKeys = exportedKeys.filter(
    (key) => /gate|withhold|suppress/i.test(key)
  );

  // buildQualityGateInputs is a data builder, not a decision-maker — allowed
  const decisionMakerKeys = gateLikeKeys.filter(
    (key) => key !== 'buildQualityGateInputs'
  );

  assert.equal(
    decisionMakerKeys.length,
    0,
    `pose-engine must not export gating decision functions, found: ${decisionMakerKeys.join(', ')}`
  );
});

test('PoseEngine.getFrameQuality returns only signal data, no decisions', () => {
  const { PoseEngine } = require('../../public/js/workout/pose-engine.js');
  const engine = new PoseEngine();

  // Mock landmarks for a minimal test
  const mockLandmarks = new Array(33).fill(null).map((_, i) => ({
    x: 0.5,
    y: 0.5,
    z: 0.0,
    visibility: 0.9,
  }));

  const quality = engine.getFrameQuality(mockLandmarks, 'SIDE');

  // Quality output must be a signal object with numeric scores, not a decision
  assert.ok('score' in quality, 'quality must have score');
  assert.ok('level' in quality, 'quality must have level');
  assert.ok('factor' in quality, 'quality must have factor');
  assert.ok('trackedJointRatio' in quality, 'quality must have trackedJointRatio');
  assert.ok('inFrameRatio' in quality, 'quality must have inFrameRatio');
  assert.ok('viewStability' in quality, 'quality must have viewStability');

  // Must NOT contain decision fields
  assert.equal('result' in quality, false, 'quality must not have result field');
  assert.equal('withhold' in quality, false, 'quality must not have withhold field');
  assert.equal('pass' in quality, false, 'quality must not have pass field');
});
