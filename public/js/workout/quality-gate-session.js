/**
 * quality-gate-session.js
 *
 * 운동 세션 중 자세 품질을 평가하여 스코어링 시작/중단을 제어하는 모듈.
 * 프레임 안정성, 관절 가시성, 시점 일치 등을 체크하여 조건이 충족되지 않으면
 * 스코어링을 유보(withhold)하고, 안정화되면 다시 재개합니다.
 */

/**
 * 품질 게이트 유보 사유를 사용자에게 보여줄 안내 메시지로 변환합니다.
 * @param {string} reason - 유보 사유 키 (out_of_frame, joints_missing, 등)
 * @returns {string} 안내 메시지
 */
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

/**
 * 안정 프레임 수가 임계값을 넘었는지 확인하여 스코어링 재개 여부를 판단합니다.
 * @param {Object} params
 * @param {number} params.stableFrameCount - 연속 안정 프레임 수
 * @param {number} params.threshold - 재개에 필요한 최소 안정 프레임 수
 * @returns {boolean} 재개 가능 여부
 */
function shouldResumeScoring({ stableFrameCount, threshold }) {
  return stableFrameCount >= threshold;
}

/**
 * 현재 프레임의 자세 품질이 안정적인지 판단합니다.
 * 품질 등급이 LOW가 아니고 시점 안정성(viewStability)이 0.5 이상이면 안정으로 간주합니다.
 * @param {Object} poseData - pose-engine에서 전달된 자세 데이터
 * @returns {boolean} 프레임 안정 여부
 */
function isFrameStable(poseData) {
  const quality = poseData?.angles?.quality;
  if (!quality) return false;
  return quality.level !== 'LOW' && quality.viewStability >= 0.5;
}

/**
 * 모바일 전면 카메라 미리보기는 좌우 반전이 필요하므로 반전 여부를 반환합니다.
 * @param {string} sourceType - 카메라 소스 타입
 * @returns {boolean} 미리보기 반전 필요 여부
 */
function shouldMirrorSourcePreview(sourceType) {
  return sourceType === 'mobile_front';
}

/**
 * 품질 게이트 추적기 객체를 초기화합니다.
 * 추적기는 프레임 안정성 카운트, 최근 안정성 윈도우, 스코어링 유보 상태 등을 관리합니다.
 * @returns {Object} 품질 게이트 추적기 객체
 */
function createQualityGateTracker() {
  return {
    stableFrameCount: 0,
    recentStabilityWindow: [],
    isWithholding: false,
    withholdReason: null,
  };
}

/**
 * 새로운 poseData를 받아 품질 게이트 추적기를 갱신합니다.
 * 최근 12프레임의 안정성 이력을 유지하며, 연속 안정 프레임 수와 불안정 프레임 비율을 계산합니다.
 * @param {Object} poseData - 현재 프레임의 자세 데이터
 * @param {Object} tracker - 품질 게이트 추적기 객체
 * @returns {Object} { stableFrameCount, unstableFrameRatio }
 */
function updateQualityGateTracker(poseData, tracker) {
  const stable = isFrameStable(poseData);
  tracker.recentStabilityWindow.push(stable);

  // 최근 12프레임만 유지 (슬라이딩 윈도우)
  const windowSize = 12;
  if (tracker.recentStabilityWindow.length > windowSize) {
    tracker.recentStabilityWindow.shift();
  }

  // 연속 안정 프레임 수: 현재 프레임이 안정이면 +1, 불안정하면 0으로 리셋
  tracker.stableFrameCount = stable ? tracker.stableFrameCount + 1 : 0;

  // 윈도우 내 불안정 프레임 비율 계산
  const unstableCount = tracker.recentStabilityWindow.filter((value) => !value).length;
  const unstableFrameRatio = tracker.recentStabilityWindow.length > 0
    ? unstableCount / tracker.recentStabilityWindow.length
    : 0;

  return {
    stableFrameCount: tracker.stableFrameCount,
    unstableFrameRatio,
  };
}

/**
 * Node.js(CommonJS) 환경에서 buildQualityGateInputs 함수를 가져옵니다.
 * 브라우저 환경에서는 window 객체에서 찾습니다.
 * @returns {Function|null} buildQualityGateInputs 함수 또는 null
 */
function resolveBuildQualityGateInputs() {
  if (typeof module !== 'undefined' && typeof require === 'function') {
    return require('./pose-engine.js').buildQualityGateInputs;
  }

  if (typeof window !== 'undefined') {
    return window.buildQualityGateInputs || null;
  }

  return null;
}

/**
 * poseData와 안정성 지표로부터 품질 게이트 입력값을 구성합니다.
 * raw 값을 추출한 뒤 pose-engine의 buildQualityGateInputs로 정규화하여 반환합니다.
 * @param {Object} poseData - 현재 프레임의 자세 데이터
 * @param {Object} stabilityMetrics - { stableFrameCount, unstableFrameRatio }
 * @returns {Object} 정규화된 품질 게이트 입력값
 */
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

  const buildQualityGateInputs = resolveBuildQualityGateInputs();
  if (typeof buildQualityGateInputs !== 'function') {
    throw new Error('buildQualityGateInputs helper is unavailable.');
  }

  return buildQualityGateInputs(rawInputs);
}

/**
 * 품질 게이트 결과와 추적기 상태를 기반으로 스코어링 억제 여부를 결정합니다.
 * - 게이트 결과가 'withhold'이면 스코어링 중단 및 사유 기록
 * - 유보 상태 중이고 안정 프레임이 임계값 미만이면 계속 억제
 * - 조건 충족 시 유보 해제 및 스코어링 재개
 * @param {Object} gateResult - 품질 게이트 평가 결과 { result, reason }
 * @param {Object} tracker - 품질 게이트 추적기
 * @param {number} threshold - 재개에 필요한 안정 프레임 수
 * @returns {Object} { suppress: boolean, reason: string|null }
 */
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
