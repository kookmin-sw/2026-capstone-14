const test = require('node:test');
const assert = require('node:assert/strict');
const {
  QUALITY_GATE_THRESHOLDS,
  evaluateQualityGate,
} = require('../../public/js/workout/scoring-engine.js');

test('evaluateQualityGate returns withhold for low key-joint visibility', () => {
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
  assert.equal(result.reason, 'key_joints_not_visible');
});

test('evaluateQualityGate returns withhold for body not fully visible', () => {
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
  assert.equal(result.reason, 'body_not_fully_visible');
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
});

test('evaluateQualityGate returns withhold for unstable tracking', () => {
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
  assert.equal(result.reason, 'unstable_tracking');
});

test('evaluateQualityGate returns withhold for insufficient stable frames', () => {
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
  assert.equal(result.reason, 'insufficient_stable_frames');
});

test('evaluateQualityGate returns withhold for camera too close or far', () => {
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
  assert.equal(result.reason, 'camera_too_close_or_far');
});

test('evaluateQualityGate returns withhold for low detection confidence', () => {
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
  assert.equal(result.reason, 'low_detection_confidence');
});

test('evaluateQualityGate returns withhold for low tracking confidence', () => {
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
  assert.equal(result.reason, 'low_tracking_confidence');
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
