const test = require('node:test');
const assert = require('node:assert/strict');

const {
  mapWithholdReasonToMessage,
  shouldResumeScoring,
  isFrameStable,
  shouldMirrorSourcePreview,
  createQualityGateTracker,
  updateQualityGateTracker,
  buildGateInputsFromPoseData,
  shouldSuppressScoring,
} = require('../../public/js/workout/quality-gate-session.js');

function makePoseData(qualityLevel, viewStability, view = 'FRONT') {
  return {
    angles: {
      view,
      quality: {
        level: qualityLevel,
        viewStability,
        avgVisibility: 0.8,
        minVisibility: 0.75,
        visibleRatio: 0.75,
        inFrameRatio: 0.95,
      },
    },
  };
}

test('mapWithholdReasonToMessage returns the view mismatch guidance', () => {
  assert.equal(
    mapWithholdReasonToMessage('view_mismatch'),
    '현재 운동은 옆면 시점이 필요합니다.',
  );
});

test('shouldResumeScoring requires the full stable-frame streak', () => {
  assert.equal(shouldResumeScoring({ stableFrameCount: 7, threshold: 8 }), false);
  assert.equal(shouldResumeScoring({ stableFrameCount: 8, threshold: 8 }), true);
});

test('isFrameStable rejects LOW quality and low view stability', () => {
  assert.equal(isFrameStable(makePoseData('HIGH', 0.8)), true);
  assert.equal(isFrameStable(makePoseData('LOW', 0.8)), false);
  assert.equal(isFrameStable(makePoseData('HIGH', 0.4)), false);
});

test('shouldMirrorSourcePreview mirrors only mobile front sources', () => {
  assert.equal(shouldMirrorSourcePreview('screen'), false);
  assert.equal(shouldMirrorSourcePreview('mobile_front'), true);
});

test('updateQualityGateTracker resets stable count on unstable frame', () => {
  const tracker = createQualityGateTracker();
  updateQualityGateTracker(makePoseData('HIGH', 0.8), tracker);
  updateQualityGateTracker(makePoseData('HIGH', 0.8), tracker);
  const metrics = updateQualityGateTracker(makePoseData('LOW', 0.4), tracker);

  assert.equal(metrics.stableFrameCount, 0);
  assert.equal(tracker.stableFrameCount, 0);
});

test('buildGateInputsFromPoseData returns normalized gate fields', () => {
  const result = buildGateInputsFromPoseData(
    makePoseData('HIGH', 0.7, 'SIDE'),
    {
      stableFrameCount: 5,
      unstableFrameRatio: 0.1,
    },
  );

  assert.equal(result.estimatedView, 'SIDE');
  assert.equal(result.frameInclusionRatio, 0.95);
  assert.equal(result.stableFrameCount, 5);
  assert.equal(result.unstableFrameRatio, 0.1);
});

test('shouldSuppressScoring preserves withholding until stable frames return', () => {
  const tracker = createQualityGateTracker();

  const withholdResult = shouldSuppressScoring(
    { result: 'withhold', reason: 'view_mismatch' },
    tracker,
    8,
  );
  assert.equal(withholdResult.suppress, true);
  assert.equal(tracker.isWithholding, true);
  assert.equal(tracker.withholdReason, 'view_mismatch');

  tracker.stableFrameCount = 8;
  const resumeResult = shouldSuppressScoring(
    { result: 'pass', reason: null },
    tracker,
    8,
  );
  assert.equal(resumeResult.suppress, false);
  assert.equal(tracker.isWithholding, false);
  assert.equal(tracker.withholdReason, null);
});
