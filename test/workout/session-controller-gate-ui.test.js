const test = require('node:test');
const assert = require('node:assert/strict');
const {
  mapWithholdReasonToMessage,
  shouldResumeScoring,
  createQualityGateTracker,
  updateQualityGateTracker,
  buildGateInputsFromPoseData,
  shouldSuppressScoring,
  isFrameStable,
  shouldMirrorSourcePreview,
} = require('../../public/js/workout/session-controller.js');

test('mapWithholdReasonToMessage returns correct messages for all reason codes', () => {
  assert.equal(
    mapWithholdReasonToMessage('out_of_frame'),
    '머리부터 발끝까지 프레임 안에 들어오도록 위치를 조정해주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('joints_missing'),
    '어깨부터 손목, 골반과 하체까지 전신이 보이도록 카메라를 맞춰주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('view_mismatch'),
    '현재 운동은 옆면 시점이 필요합니다.'
  );
  assert.equal(
    mapWithholdReasonToMessage('view_unstable'),
    '몸 방향이 흔들리고 있습니다. 측면 자세를 유지해주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('low_confidence'),
    '카메라 위치와 조명을 조정한 뒤 다시 자세를 잡아주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('tracked_joints_low'),
    '팔과 하체가 모두 보이도록 카메라를 조금 더 멀리 두세요.'
  );
});

test('mapWithholdReasonToMessage handles all spec-standardized reason codes', () => {
  assert.equal(
    mapWithholdReasonToMessage('out_of_frame'),
    '머리부터 발끝까지 프레임 안에 들어오도록 위치를 조정해주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('joints_missing'),
    '어깨부터 손목, 골반과 하체까지 전신이 보이도록 카메라를 맞춰주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('tracked_joints_low'),
    '팔과 하체가 모두 보이도록 카메라를 조금 더 멀리 두세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('view_unstable'),
    '몸 방향이 흔들리고 있습니다. 측면 자세를 유지해주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage('low_confidence'),
    '카메라 위치와 조명을 조정한 뒤 다시 자세를 잡아주세요.'
  );
  // view_mismatch already tested above — kept for completeness
  assert.equal(
    mapWithholdReasonToMessage('view_mismatch'),
    '현재 운동은 옆면 시점이 필요합니다.'
  );
});

test('mapWithholdReasonToMessage returns fallback for unknown reason', () => {
  assert.equal(
    mapWithholdReasonToMessage('unknown_reason'),
    '카메라와 자세를 다시 맞춰 주세요.'
  );
  assert.equal(
    mapWithholdReasonToMessage(''),
    '카메라와 자세를 다시 맞춰 주세요.'
  );
});

test('shouldResumeScoring requires the full stable-frame streak', () => {
  assert.equal(shouldResumeScoring({ stableFrameCount: 7, threshold: 8 }), false);
  assert.equal(shouldResumeScoring({ stableFrameCount: 8, threshold: 8 }), true);
  assert.equal(shouldResumeScoring({ stableFrameCount: 10, threshold: 8 }), true);
  assert.equal(shouldResumeScoring({ stableFrameCount: 0, threshold: 8 }), false);
});

test('shouldResumeScoring handles edge cases', () => {
  assert.equal(shouldResumeScoring({ stableFrameCount: 0, threshold: 0 }), true);
  assert.equal(shouldResumeScoring({ stableFrameCount: -1, threshold: 8 }), false);
});

function makePoseData(qualityLevel, viewStability, view = 'FRONT') {
  return {
    angles: {
      view,
      quality: {
        level: qualityLevel,
        viewStability: viewStability,
        avgVisibility: 0.8,
        minVisibility: 0.75,
        visibleRatio: 0.75,
        inFrameRatio: 0.95,
      },
    },
  };
}

test('createQualityGateTracker returns initial state', () => {
  const tracker = createQualityGateTracker();
  assert.equal(tracker.stableFrameCount, 0);
  assert.deepStrictEqual(tracker.recentStabilityWindow, []);
  assert.equal(tracker.isWithholding, false);
  assert.equal(tracker.withholdReason, null);
});

test('isFrameStable returns true for good quality', () => {
  assert.equal(isFrameStable(makePoseData('HIGH', 0.8)), true);
  assert.equal(isFrameStable(makePoseData('MEDIUM', 0.6)), true);
});

test('isFrameStable returns false for LOW quality or low viewStability', () => {
  assert.equal(isFrameStable(makePoseData('LOW', 0.8)), false);
  assert.equal(isFrameStable(makePoseData('HIGH', 0.4)), false);
  assert.equal(isFrameStable(makePoseData('LOW', 0.3)), false);
});

test('shouldMirrorSourcePreview mirrors only explicit front-camera sources', () => {
  assert.equal(shouldMirrorSourcePreview('webcam'), false);
  assert.equal(shouldMirrorSourcePreview('screen'), false);
  assert.equal(shouldMirrorSourcePreview('mobile_rear'), false);
  assert.equal(shouldMirrorSourcePreview('mobile_front'), true);
});

test('updateQualityGateTracker increments stableFrameCount on consecutive stable frames', () => {
  const tracker = createQualityGateTracker();
  const metrics1 = updateQualityGateTracker(makePoseData('HIGH', 0.8), tracker);
  assert.equal(metrics1.stableFrameCount, 1);
  const metrics2 = updateQualityGateTracker(makePoseData('HIGH', 0.8), tracker);
  assert.equal(metrics2.stableFrameCount, 2);
  assert.equal(tracker.stableFrameCount, 2);
});

test('updateQualityGateTracker resets stableFrameCount after unstable frame', () => {
  const tracker = createQualityGateTracker();
  updateQualityGateTracker(makePoseData('HIGH', 0.8), tracker);
  updateQualityGateTracker(makePoseData('HIGH', 0.8), tracker);
  assert.equal(tracker.stableFrameCount, 2);
  const metrics = updateQualityGateTracker(makePoseData('LOW', 0.8), tracker);
  assert.equal(metrics.stableFrameCount, 0);
  assert.equal(tracker.stableFrameCount, 0);
});

test('updateQualityGateTracker computes unstableFrameRatio over window', () => {
  const tracker = createQualityGateTracker();
  for (let i = 0; i < 10; i++) {
    updateQualityGateTracker(makePoseData('HIGH', 0.8), tracker);
  }
  for (let i = 0; i < 2; i++) {
    updateQualityGateTracker(makePoseData('LOW', 0.8), tracker);
  }
  const metrics = updateQualityGateTracker(makePoseData('HIGH', 0.8), tracker);
  assert.equal(metrics.unstableFrameRatio, 2 / 12);
});

test('buildGateInputsFromPoseData maps pose quality to gate inputs', () => {
  const metrics = { stableFrameCount: 5, unstableFrameRatio: 0.1 };
  const inputs = buildGateInputsFromPoseData(makePoseData('HIGH', 0.7, 'SIDE'), metrics);
  assert.equal(inputs.frameInclusionRatio, 0.95);
  assert.equal(inputs.keyJointVisibilityAverage, 0.8);
  assert.equal(inputs.minKeyJointVisibility, 0.75);
  assert.equal(inputs.estimatedView, 'SIDE');
  assert.equal(inputs.estimatedViewConfidence, 0.7);
  assert.equal(inputs.detectionConfidence, 0.8);
  assert.equal(inputs.trackingConfidence, 0.8);
  assert.equal(inputs.stableFrameCount, 5);
  assert.equal(inputs.unstableFrameRatio, 0.1);
  assert.equal(inputs.cameraDistanceOk, true);
});

test('shouldSuppressScoring suppresses when gate returns withhold', () => {
  const tracker = createQualityGateTracker();
  const result = shouldSuppressScoring(
    { result: 'withhold', reason: 'view_mismatch' },
    tracker,
    8
  );
  assert.equal(result.suppress, true);
  assert.equal(result.reason, 'view_mismatch');
  assert.equal(tracker.isWithholding, true);
  assert.equal(tracker.withholdReason, 'view_mismatch');
});

test('shouldSuppressScoring stays suppressed until stable-frame threshold is restored', () => {
  const tracker = createQualityGateTracker();
  tracker.isWithholding = true;
  tracker.withholdReason = 'view_unstable';
  tracker.stableFrameCount = 5;

  const result = shouldSuppressScoring(
    { result: 'pass', reason: null },
    tracker,
    8
  );
  assert.equal(result.suppress, true);
  assert.equal(tracker.isWithholding, true);
});

test('shouldSuppressScoring resumes scoring once stable-frame threshold is met', () => {
  const tracker = createQualityGateTracker();
  tracker.isWithholding = true;
  tracker.withholdReason = 'view_unstable';
  tracker.stableFrameCount = 8;

  const result = shouldSuppressScoring(
    { result: 'pass', reason: null },
    tracker,
    8
  );
  assert.equal(result.suppress, false);
  assert.equal(result.reason, null);
  assert.equal(tracker.isWithholding, false);
  assert.equal(tracker.withholdReason, null);
});

test('shouldSuppressScoring clears tracker state on resume', () => {
  const tracker = createQualityGateTracker();
  // First trigger withhold
  shouldSuppressScoring({ result: 'withhold', reason: 'out_of_frame' }, tracker, 8);
  assert.equal(tracker.isWithholding, true);

  // Then restore stability
  tracker.stableFrameCount = 10;
  const result = shouldSuppressScoring({ result: 'pass', reason: null }, tracker, 8);
  assert.equal(result.suppress, false);
  assert.equal(tracker.isWithholding, false);
  assert.equal(tracker.withholdReason, null);
});

test('live controller wiring: full quality-gate frame flow suppresses and resumes', () => {
  const tracker = createQualityGateTracker();

  // Simulate a withhold frame
  const badPose = makePoseData('LOW', 0.3, 'FRONT');
  const metrics1 = updateQualityGateTracker(badPose, tracker);
  const inputs1 = buildGateInputsFromPoseData(badPose, metrics1);
  // Manually evaluate gate (simulating what handlePoseDetected does)
  const gateResult1 = { result: 'withhold', reason: 'view_unstable' };
  const suppression1 = shouldSuppressScoring(gateResult1, tracker, 8);
  assert.equal(suppression1.suppress, true);

  // Simulate 7 stable frames after withhold — still suppressed
  for (let i = 0; i < 7; i++) {
    const goodPose = makePoseData('HIGH', 0.8, 'FRONT');
    const metrics = updateQualityGateTracker(goodPose, tracker);
    const gateResult = { result: 'pass', reason: null };
    const suppression = shouldSuppressScoring(gateResult, tracker, 8);
    if (i < 6) {
      assert.equal(suppression.suppress, true, `should still suppress at stable frame ${metrics.stableFrameCount}`);
    }
  }

  // 8th stable frame — resume
  const finalPose = makePoseData('HIGH', 0.8, 'FRONT');
  const finalMetrics = updateQualityGateTracker(finalPose, tracker);
  assert.equal(finalMetrics.stableFrameCount, 8);
  const finalGate = { result: 'pass', reason: null };
  const finalSuppression = shouldSuppressScoring(finalGate, tracker, 8);
  assert.equal(finalSuppression.suppress, false);
  assert.equal(tracker.isWithholding, false);
});
