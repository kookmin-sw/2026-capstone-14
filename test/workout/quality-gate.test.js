const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QUALITY_GATE_THRESHOLDS,
  GATE_ONLY_REASONS,
  evaluateQualityGate,
} = require('../../public/js/workout/scoring-engine.js');

test('GATE_ONLY_REASONS is exported and contains exactly the canonical six codes', () => {
  assert.ok(Array.isArray(GATE_ONLY_REASONS));
  assert.equal(GATE_ONLY_REASONS.length, 6);
  assert.ok(GATE_ONLY_REASONS.includes('out_of_frame'));
  assert.ok(GATE_ONLY_REASONS.includes('tracked_joints_low'));
  assert.ok(GATE_ONLY_REASONS.includes('view_unstable'));
  assert.ok(GATE_ONLY_REASONS.includes('view_mismatch'));
  assert.ok(GATE_ONLY_REASONS.includes('low_confidence'));
  assert.ok(GATE_ONLY_REASONS.includes('joints_missing'));
});

test('evaluateQualityGate returns withhold for low key-joint visibility → joints_missing', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.92,
    keyJointVisibilityAverage: 0.51,
    minKeyJointVisibility: 0.48,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.83,
    detectionConfidence: 0.91,
    trackingConfidence: 0.90,
    stableFrameCount: 12,
    unstableFrameRatio: 0.08,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'joints_missing');
  assert.ok(GATE_ONLY_REASONS.includes(result.reason));
});

test('evaluateQualityGate returns withhold for body not fully visible → out_of_frame', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.70,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.70,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.90,
    trackingConfidence: 0.90,
    stableFrameCount: 12,
    unstableFrameRatio: 0.05,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'out_of_frame');
  assert.ok(GATE_ONLY_REASONS.includes(result.reason));
});

test('evaluateQualityGate returns withhold for view mismatch (disallowed view)', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.70,
    estimatedView: 'FRONT',
    estimatedViewConfidence: 0.90,
    detectionConfidence: 0.92,
    trackingConfidence: 0.93,
    stableFrameCount: 10,
    unstableFrameRatio: 0.05,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'view_mismatch');
  assert.ok(GATE_ONLY_REASONS.includes(result.reason));
});

test('evaluateQualityGate returns withhold for view mismatch (low confidence)', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.70,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.45,
    detectionConfidence: 0.92,
    trackingConfidence: 0.93,
    stableFrameCount: 10,
    unstableFrameRatio: 0.05,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'view_mismatch');
  assert.ok(GATE_ONLY_REASONS.includes(result.reason));
});

test('evaluateQualityGate returns withhold for unstable tracking → view_unstable', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.70,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.92,
    trackingConfidence: 0.93,
    stableFrameCount: 10,
    unstableFrameRatio: 0.45,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'view_unstable');
  assert.ok(GATE_ONLY_REASONS.includes(result.reason));
});

test('evaluateQualityGate returns withhold for insufficient stable frames → view_unstable', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.70,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.92,
    trackingConfidence: 0.93,
    stableFrameCount: 3,
    unstableFrameRatio: 0.05,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'view_unstable');
  assert.ok(GATE_ONLY_REASONS.includes(result.reason));
});

test('evaluateQualityGate returns withhold for camera too close or far → out_of_frame', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.70,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.92,
    trackingConfidence: 0.93,
    stableFrameCount: 10,
    unstableFrameRatio: 0.05,
    cameraDistanceOk: false,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'out_of_frame');
  assert.ok(GATE_ONLY_REASONS.includes(result.reason));
});

test('evaluateQualityGate returns withhold for low detection confidence → low_confidence', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.70,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.30,
    trackingConfidence: 0.93,
    stableFrameCount: 10,
    unstableFrameRatio: 0.05,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'low_confidence');
  assert.ok(GATE_ONLY_REASONS.includes(result.reason));
});

test('evaluateQualityGate returns withhold for low tracking confidence → tracked_joints_low', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.70,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.92,
    trackingConfidence: 0.30,
    stableFrameCount: 10,
    unstableFrameRatio: 0.05,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'tracked_joints_low');
  assert.ok(GATE_ONLY_REASONS.includes(result.reason));
});

test('evaluateQualityGate returns pass when all seed thresholds are met', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.71,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.79,
    detectionConfidence: 0.92,
    trackingConfidence: 0.93,
    stableFrameCount: QUALITY_GATE_THRESHOLDS.stableFrameCount,
    unstableFrameRatio: 0.10,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['SIDE'],
    selectedView: 'SIDE',
  });

  assert.equal(result.result, 'pass');
  assert.equal(result.reason, null);
});

test('evaluateQualityGate prioritizes selectedView over broad allowedViews', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.71,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.92,
    trackingConfidence: 0.93,
    stableFrameCount: QUALITY_GATE_THRESHOLDS.stableFrameCount,
    unstableFrameRatio: 0.10,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['FRONT', 'SIDE', 'DIAGONAL'],
    selectedView: 'FRONT',
  });

  assert.equal(result.result, 'withhold');
  assert.equal(result.reason, 'view_mismatch');
});

test('evaluateQualityGate uses allowedViews fallback when selectedView is DIAGONAL', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.71,
    estimatedView: 'SIDE',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.92,
    trackingConfidence: 0.93,
    stableFrameCount: QUALITY_GATE_THRESHOLDS.stableFrameCount,
    unstableFrameRatio: 0.10,
    cameraDistanceOk: true,
  }, {
    allowedViews: ['FRONT', 'SIDE', 'DIAGONAL'],
    selectedView: 'DIAGONAL',
  });

  assert.equal(result.result, 'pass');
  assert.equal(result.reason, null);
});

test('evaluateQualityGate passes without context (no allowedViews)', () => {
  const result = evaluateQualityGate({
    frameInclusionRatio: 0.95,
    keyJointVisibilityAverage: 0.80,
    minKeyJointVisibility: 0.71,
    estimatedView: 'FRONT',
    estimatedViewConfidence: 0.80,
    detectionConfidence: 0.92,
    trackingConfidence: 0.93,
    stableFrameCount: QUALITY_GATE_THRESHOLDS.stableFrameCount,
    unstableFrameRatio: 0.10,
    cameraDistanceOk: true,
  });

  assert.equal(result.result, 'pass');
  assert.equal(result.reason, null);
});

test('evaluateQualityGate never emits a reason outside GATE_ONLY_REASONS', () => {
  // Exhaustive withhold-path tests: every withhold reason must be in GATE_ONLY_REASONS
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
    assert.equal(result.result, 'withhold');
    assert.ok(GATE_ONLY_REASONS.includes(result.reason), `reason "${result.reason}" must be in GATE_ONLY_REASONS`);
  }
});

test('QUALITY_GATE_THRESHOLDS has all seed values from spec', () => {
  assert.equal(QUALITY_GATE_THRESHOLDS.detectionConfidence, 0.50);
  assert.equal(QUALITY_GATE_THRESHOLDS.trackingConfidence, 0.50);
  assert.equal(QUALITY_GATE_THRESHOLDS.estimatedViewConfidence, 0.60);
  assert.equal(QUALITY_GATE_THRESHOLDS.keyJointVisibilityAverage, 0.65);
  assert.equal(QUALITY_GATE_THRESHOLDS.minKeyJointVisibility, 0.40);
  assert.equal(QUALITY_GATE_THRESHOLDS.stableFrameCount, 8);
  assert.equal(QUALITY_GATE_THRESHOLDS.stabilityWindow, 12);
  assert.equal(QUALITY_GATE_THRESHOLDS.unstableFrameRatio, 0.30);
  assert.equal(QUALITY_GATE_THRESHOLDS.frameInclusionRatio, 0.85);
});
