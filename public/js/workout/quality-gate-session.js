function mapWithholdReasonToMessage(reason) {
  const messages = {
    out_of_frame: '머리부터 발끝까지 프레임 안에 들어오도록 위치를 조정해주세요.',
    joints_missing: '어깨부터 손목, 골반과 하체까지 전신이 보이도록 카메라를 맞춰주세요.',
    tracked_joints_low: '팔과 하체가 모두 보이도록 카메라를 조금 더 멀리 두세요.',
    view_unstable: '몸 방향이 흔들리고 있습니다. 측면 자세를 유지해주세요.',
    view_mismatch: '현재 운동은 옆면 시점이 필요합니다.',
    low_confidence: '카메라 위치와 조명을 조정한 뒤 다시 자세를 잡아주세요.',
  };

  return messages[reason] || '카메라와 자세를 다시 맞춰 주세요.';
}

function shouldResumeScoring({ stableFrameCount, threshold }) {
  return stableFrameCount >= threshold;
}

function isFrameStable(poseData) {
  const quality = poseData?.angles?.quality;
  if (!quality) return false;
  return quality.level !== 'LOW' && quality.viewStability >= 0.5;
}

function shouldMirrorSourcePreview(sourceType) {
  return sourceType === 'mobile_front';
}

function createQualityGateTracker() {
  return {
    stableFrameCount: 0,
    recentStabilityWindow: [],
    isWithholding: false,
    withholdReason: null,
  };
}

function updateQualityGateTracker(poseData, tracker) {
  const stable = isFrameStable(poseData);
  tracker.recentStabilityWindow.push(stable);

  const windowSize = 12;
  if (tracker.recentStabilityWindow.length > windowSize) {
    tracker.recentStabilityWindow.shift();
  }

  tracker.stableFrameCount = stable ? tracker.stableFrameCount + 1 : 0;

  const unstableCount = tracker.recentStabilityWindow.filter((value) => !value).length;
  const unstableFrameRatio = tracker.recentStabilityWindow.length > 0
    ? unstableCount / tracker.recentStabilityWindow.length
    : 0;

  return {
    stableFrameCount: tracker.stableFrameCount,
    unstableFrameRatio,
  };
}

function buildGateInputsFromPoseData(poseData, stabilityMetrics) {
  const quality = poseData?.angles?.quality || {};
  const view = poseData?.angles?.view || 'UNKNOWN';

  const rawInputs = {
    frameInclusionRatio: quality.inFrameRatio ?? 1.0,
    keyJointVisibilityAverage: quality.avgVisibility ?? 0,
    minKeyJointVisibility: quality.minVisibility ?? 0,
    estimatedView: view,
    estimatedViewConfidence: quality.viewStability ?? 0,
    detectionConfidence: quality.avgVisibility ?? 0,
    trackingConfidence: quality.avgVisibility ?? 0,
    stableFrameCount: stabilityMetrics.stableFrameCount,
    unstableFrameRatio: stabilityMetrics.unstableFrameRatio,
    cameraDistanceOk: true,
  };

  if (typeof buildQualityGateInputs === 'function') {
    return buildQualityGateInputs(rawInputs);
  }

  return rawInputs;
}

function shouldSuppressScoring(gateResult, tracker, threshold) {
  if (gateResult.result === 'withhold') {
    tracker.isWithholding = true;
    tracker.withholdReason = gateResult.reason;
    return { suppress: true, reason: gateResult.reason };
  }

  if (
    tracker.isWithholding &&
    !shouldResumeScoring({
      stableFrameCount: tracker.stableFrameCount,
      threshold,
    })
  ) {
    return {
      suppress: true,
      reason: tracker.withholdReason || 'insufficient_stable_frames',
    };
  }

  tracker.isWithholding = false;
  tracker.withholdReason = null;
  return { suppress: false, reason: null };
}

const SessionQualityGate = {
  mapWithholdReasonToMessage,
  shouldResumeScoring,
  isFrameStable,
  shouldMirrorSourcePreview,
  createQualityGateTracker,
  updateQualityGateTracker,
  buildGateInputsFromPoseData,
  shouldSuppressScoring,
};

if (typeof window !== 'undefined') {
  window.SessionQualityGate = SessionQualityGate;
}

if (typeof module !== 'undefined') {
  module.exports = SessionQualityGate;
}
