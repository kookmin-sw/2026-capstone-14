/**
 * routine-session-manager.js
 *
 * 루틴(여러 운동을 순차적으로 수행)의 진행 상태를 관리하는 모듈.
 * 세트/스텝 전환, REST 타이머 시작, 루틴 완료 처리, 서버에 세트 결과 저장 등을 담당합니다.
 */

/**
 * 서버가 반환한 액션에 따라 다음 루틴 진행 방향을 결정합니다.
 * 명시적 액션(NEXT_SET, NEXT_STEP, ROUTINE_COMPLETE)이 있으면 그대로 따르고,
 * 없으면 현재 세트 수와 총 세트 수, 다음 운동 스텝 존재 여부를 기반으로 기본 동작을 결정합니다.
 * @param {Object} params
 * @param {string} params.action - 서버가 반환한 액션
 * @param {number} params.restSec - 서버가 지정한 휴식 시간
 * @param {number|null} params.nextSessionId - 다음 세션 ID
 * @param {number} params.currentSet - 현재 세트 번호
 * @param {number} params.totalSets - 총 세트 수
 * @param {boolean} params.hasNextExerciseStep - 다음 운동 스텝 존재 여부
 * @param {number} params.fallbackRestSec - 기본 휴식 시간
 * @returns {Object} { action, restSec, nextSessionId }
 */
function resolveRoutineAdvanceAction({
  action,
  restSec = 0,
  nextSessionId = null,
  currentSet = 1,
  totalSets = 1,
  hasNextExerciseStep = false,
  fallbackRestSec = 0,
}) {
  const normalizedAction = String(action || '').toUpperCase();

  if (normalizedAction === 'NEXT_SET') {
    return { action: 'NEXT_SET', restSec, nextSessionId };
  }

  if (normalizedAction === 'NEXT_STEP') {
    return { action: 'NEXT_STEP', restSec, nextSessionId };
  }

  if (normalizedAction === 'ROUTINE_COMPLETE') {
    return { action: 'ROUTINE_COMPLETE', restSec, nextSessionId };
  }

  // 명시적 액션이 없으면 기본 로직 적용
  if (currentSet < totalSets) {
    return { action: 'NEXT_SET', restSec: fallbackRestSec, nextSessionId };
  }

  if (hasNextExerciseStep) {
    return { action: 'NEXT_STEP', restSec: fallbackRestSec, nextSessionId };
  }

  return {
    action: 'ROUTINE_COMPLETE',
    restSec: fallbackRestSec,
    nextSessionId,
  };
}

/**
 * 루틴의 스텝(개별 운동) 상태를 초기화합니다.
 * 세트 번호, 반복 횟수, 작업 시간, 플랭크 관련 상태, 반복 메트릭 버퍼 등을 모두 리셋합니다.
 * 새로운 운동으로 전환될 때 호출됩니다.
 * @param {Object} state - 루틴 상태 객체
 */
function resetRoutineStepState(state = {}) {
  state.currentSet = 1;
  state.currentRep = 0;
  state.currentSetWorkSec = 0;
  state.currentSegmentSec = 0;
  state.bestHoldSec = 0;
  state.plankGoalReached = false;
  state.restAfterAction = null;
  state.repMetricBuffer = {};
  state.lastRepMetricSummary = [];
  state.repInProgressPrev = false;
}

/**
 * 루틴의 세트 상태를 초기화합니다.
 * 스텝 리셋과 유사하지만 currentSet은 유지한 채 반복/시간/메트릭 관련 필드만 리셋합니다.
 * 다음 세트로 넘어갈 때 호출됩니다.
 * @param {Object} state - 루틴 상태 객체
 */
function resetRoutineSetState(state = {}) {
  state.currentRep = 0;
  state.currentSetWorkSec = 0;
  state.currentSegmentSec = 0;
  state.bestHoldSec = 0;
  state.plankGoalReached = false;
  state.repMetricBuffer = {};
  state.lastRepMetricSummary = [];
  state.repInProgressPrev = false;
}

/**
 * 현재 스텝 인덱스에 해당하는 운동 설정 정보를 추출합니다.
 * 운동 종류, 스코어링 프로파일, 목표 시간(TIME 타입일 경우), 기본 시점 등을 반환합니다.
 * @param {Object} params
 * @param {Array} params.routineSetup - 루틴 설정 배열
 * @param {number} params.stepIndex - 현재 스텝 인덱스
 * @param {Function} params.normalizeTargetType - target_type 정규화 함수
 * @param {Function} params.resolveDefaultView - 기본 시점 결정 함수
 * @returns {Object|null} { exercise, scoringProfile, selectedView, targetSec } 또는 null
 */
function resolveRoutineStepConfig({
  routineSetup = [],
  stepIndex = 0,
  normalizeTargetType = (value) => value,
  resolveDefaultView = () => null,
}) {
  const step = routineSetup[stepIndex];
  const exercise = step?.exercise || null;

  if (!exercise) {
    return null;
  }

  return {
    exercise,
    scoringProfile: step?.scoring_profile || null,
    selectedView: resolveDefaultView(exercise),
    targetSec:
      normalizeTargetType(step?.target_type) === 'TIME'
        ? Math.max(1, Number(step?.target_value) || 1)
        : 0,
  };
}

/**
 * 다음 운동 스텝의 인덱스를 계산합니다.
 * 배열 범위를 벗어나면 null을 반환하여 루틴 종료를 알립니다.
 * @param {Object} params
 * @param {number} params.currentStepIndex - 현재 스텝 인덱스
 * @param {Array} params.routineSetup - 루틴 설정 배열
 * @returns {number|null} 다음 스텝 인덱스 또는 null
 */
function resolveNextRoutineStepIndex({
  currentStepIndex = 0,
  routineSetup = [],
}) {
  const nextStepIndex = currentStepIndex + 1;
  return nextStepIndex < routineSetup.length ? nextStepIndex : null;
}

/**
 * 루틴 세션 매니저를 생성합니다.
 * 의존성 주입(DI) 패턴을 사용하여 상태 객체, fetch 구현, 휴식 타이머, 운동 종료 콜백 등을 받습니다.
 * @param {Object} deps - 의존성 객체
 * @param {Object} deps.state - 루틴 상태 객체
 * @param {Function} deps.fetchImpl - fetch 함수 (테스트 시 mock 가능)
 * @param {Function} deps.startRest - 휴식 타이머 시작 함수 (sec, reason)
 * @param {Function} deps.finishWorkout - 운동 전체 종료 콜백
 * @returns {Object} 루틴 세션 매니저 메서드들
 */
function createRoutineSessionManager(deps = {}) {
  const state = deps.state || {};
  const fetchImpl =
    typeof deps.fetchImpl === 'function'
      ? deps.fetchImpl
      : typeof fetch === 'function'
        ? fetch
        : null;
  const startRest =
    typeof deps.startRest === 'function' ? deps.startRest : () => {};
  const finishWorkout =
    typeof deps.finishWorkout === 'function'
      ? deps.finishWorkout
      : async () => {};

  /** 현재 운동 스텝 상태를 초기화합니다. */
  function resetStepState() {
    resetRoutineStepState(state);
  }

  /** 현재 세트 상태를 초기화합니다. */
  function resetSetState() {
    resetRoutineSetState(state);
  }

  /**
   * 완료된 루틴 세트 결과를 서버에 저장합니다.
   * 실제 값(반복 횟수 또는 시간), 점수, 지속 시간 등을 전송하고 서버의 루틴 상태를 받아옵니다.
   * @param {Object} params
   * @param {number} params.actualValue - 실제 달성 값
   * @param {string} params.targetType - 목표 타입 ('REPS' 또는 'TIME')
   * @param {number} params.durationSec - 세트 지속 시간(초)
   * @param {number} params.score - 획득 점수
   * @param {Object|null} params.sessionPayload - 추가 페이로드
   * @returns {Object|null} 서버가 반환한 루틴 상태
   */
  async function recordRoutineSetCompletion({
    actualValue,
    targetType,
    durationSec,
    score,
    sessionPayload = null,
  }) {
    if (!state.sessionId) {
      throw new Error('sessionId가 없어 루틴 세트를 저장할 수 없습니다.');
    }

    if (typeof fetchImpl !== 'function') {
      throw new Error('routine session manager requires fetch.');
    }

    const payload =
      sessionPayload && typeof sessionPayload === 'object'
        ? { ...sessionPayload }
        : {};

    payload.actual_value = Math.max(0, Math.round(Number(actualValue) || 0));
    payload.duration_sec = Math.max(0, Math.round(Number(durationSec) || 0));
    payload.score = Number.isFinite(Number(score))
      ? Math.round(Number(score))
      : null;

    if (targetType === 'REPS') {
      payload.actual_reps = payload.actual_value;
    }

    const response = await fetchImpl(`/api/workout/session/${state.sessionId}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.success) {
      throw new Error(
        data?.error || data?.message || '루틴 세트 저장에 실패했습니다.',
      );
    }

    return data?.routine || null;
  }

  /**
   * 루틴 진행 상황을 확인하고 다음 동작을 결정합니다.
   * 목표값 달성 시 서버에 세트를 저장하고, 서버 응답에 따라
   * 다음 세트/다음 운동/루틴 완료 중 하나를 실행합니다.
   * @param {Object} params
   * @param {number} params.actualValue - 현재 달성 값
   * @param {number} params.targetValue - 목표 값
   * @param {number} params.currentSet - 현재 세트 번호
   * @param {number} params.totalSets - 총 세트 수
   * @param {boolean} params.hasNextExerciseStep - 다음 운동 스텝 존재 여부
   * @param {number} params.fallbackRestSec - 기본 휴식 시간
   * @param {Object} params.payload - 서버 전송용 페이로드
   * @returns {Object} { action, restSec, nextSessionId, routineState }
   */
  async function checkRoutineProgress({
    actualValue,
    targetValue,
    currentSet,
    totalSets,
    hasNextExerciseStep,
    fallbackRestSec = 0,
    payload,
  }) {
    // 목표 미달성 시 아무 동작도 하지 않음
    if (actualValue < targetValue) {
      return { action: 'NONE', restSec: 0, nextSessionId: null };
    }

    // 목표 달성: 서버에 세트 결과 저장
    const routineState = await recordRoutineSetCompletion(payload);
    const normalizedAction = String(routineState?.action || '').toUpperCase();

    // 이미 처리된 세트(중복 요청)인 경우
    if (normalizedAction === 'ALREADY_PROCESSED') {
      return {
        action: 'ALREADY_PROCESSED',
        restSec: 0,
        nextSessionId: null,
        routineState,
      };
    }

    // 다음 동작 결정
    const actionResult = resolveRoutineAdvanceAction({
      action: routineState?.action,
      restSec: Math.max(
        0,
        Number(
          routineState?.rest_sec != null ? routineState.rest_sec : fallbackRestSec,
        ) || 0,
      ),
      nextSessionId: Number(routineState?.next_session?.session_id) || null,
      currentSet,
      totalSets,
      hasNextExerciseStep,
      fallbackRestSec: Math.max(0, Number(fallbackRestSec) || 0),
    });

    // 다음 세트/스텝인데 세션 ID가 없으면 예외
    if (
      (actionResult.action === 'NEXT_SET' || actionResult.action === 'NEXT_STEP') &&
      (!Number.isFinite(actionResult.nextSessionId) || actionResult.nextSessionId <= 0)
    ) {
      throw new Error('다음 루틴 세션 정보를 받지 못했습니다.');
    }

    // 휴식 타이머 시작
    if (actionResult.action === 'NEXT_SET' && actionResult.restSec > 0) {
      startRest(actionResult.restSec, 'NEXT_SET');
    }

    if (actionResult.action === 'NEXT_STEP' && actionResult.restSec > 0) {
      startRest(actionResult.restSec, 'NEXT_EXERCISE');
    }

    // 루틴 전체 완료
    if (actionResult.action === 'ROUTINE_COMPLETE') {
      await finishWorkout();
    }

    return {
      ...actionResult,
      routineState,
    };
  }

  return {
    checkRoutineProgress,
    recordRoutineSetCompletion,
    resetSetState,
    resetStepState,
    resolveNextRoutineStepIndex,
    resolveRoutineAdvanceAction,
    resolveRoutineStepConfig,
  };
}

if (typeof window !== 'undefined') {
  window.createRoutineSessionManager = createRoutineSessionManager;
}

if (typeof module !== 'undefined') {
  module.exports = {
    createRoutineSessionManager,
    resetRoutineSetState,
    resetRoutineStepState,
    resolveNextRoutineStepIndex,
    resolveRoutineAdvanceAction,
    resolveRoutineStepConfig,
  };
}
