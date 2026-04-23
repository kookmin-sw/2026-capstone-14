/**
 * 운동 세션 페이지 — 포즈/점수/루틴/세션 저장 오케스트레이션
  * 아키텍처 흐름:
 *   1. initAIEngines(): MediaPipe Pose + ScoringEngine + RepCounter 초기화
 *   2. connectCameraSource(): 칩처/화면 공유 스트림 연결
 *   3. startPoseDetection(): requestAnimationFrame 루프 시작 → poseEngine.send(video)
 *   4. handlePoseDetected(): 품질 게이트 → 채점 → 반복 감지 → UI 업데이트
 *   5. handleRepComplete(): rep 완료 시 서버 동기화(루틴) + 피드백 표시
 *   6. finishWorkout(): 세션 종료 + SessionBuffer.export() → 서버 저장
 *
 * @param {object} workoutData 서버에서 주입된 세션 데이터
 *   - exercise: 운동 메타데이터 (code, name, allowed_views, default_view 등)
 *   - scoringProfile: DB 채점 프로필 (없으면 운동 모듈 fallback 사용)
 *   - mode: 'FREE' | 'ROUTINE' | 'LEARN'
 *   - routine: 루틴 정보 (ROUTINE 모드일 때만)
 */
async function initSession(workoutData) {
  // ── 핵심 엔진 인스턴스 ──
  // PoseEngine: MediaPipe 기반 포즈 추론 + 각도 계산
  // ScoringEngine: 메트릭 기반 실시간 채점
  // RepCounter: 상태 머신 기반 반복/시간 감지
  // SessionBuffer: 세션 데이터 로컬 버퍼링 → 서버 전송
  // exerciseModule: 운동별 JS 모듈 (squat, push_up, plank 등)
  let poseEngine = null;
  let scoringEngine = null;
  let repCounter = null;
  let sessionBuffer = null;
  let exerciseModule = null;

  // ── 세션 상태 객체 ──
  // phase:      PREPARING → WORKING → FINISHED (핵심 라이프사이클)
  // isPaused:   일시정지 여부 (타이머/프레임 루프 일시 정지)
  // pauseRepScoring: 품질 게이트 withold 시 rep 점수 반영 일시 정지
  // routineSetSyncPending: 루틴 세트 완료 API 동기화 진행 중
  const state = {
    phase: "PREPARING",
    sessionId: null,
    selectedView: null,
    currentSet: 1,
    currentRep: 0,
    currentStepIndex: 0,
    totalTime: 0,
    restTimeLeft: 0,
    liveScore: 0,
    isPaused: false,
    timerInterval: null,
    restInterval: null,
    alertCooldown: false,
    frameLoop: null,
    lastViewInfoAt: 0,
    lastViewInfoText: "",
    repInProgressPrev: false,
    repMetricBuffer: {},
    lastRepMetricSummary: [],
    currentSetWorkSec: 0,
    restAfterAction: null,
    currentTargetSec: 0,
    currentSegmentSec: 0,
    bestHoldSec: 0,
    plankGoalReached: false,
    routineSetSyncPending: false,
    pauseRepScoring: false,
    currentWithholdReason: null,
  };

// ── DOM 요소 캐싱 ──
  const videoElement = document.getElementById("videoElement");    // 카메라 비디오 소스
  const poseCanvas = document.getElementById("poseCanvas");        // 랜드마크 오버레이 캔버스
  const cameraFrame = document.getElementById("cameraFrame");      // 카메라 프레임 컨테이너
  const cameraOverlay = document.getElementById("cameraOverlay");  // 로딩/에러 오버레이
  const statusBadge = document.getElementById("statusBadge");      // 상태 뱃지 (PREPARING/WORKING 등)
  const liveScoreEl = document.getElementById("liveScore");        // 실시간 점수 표시
  const scoreModeLabelEl = document.getElementById("scoreModeLabel");
  const scoreBreakdownEl = document.getElementById("scoreBreakdown");
  const phaseInfoEl = document.getElementById("phaseInfo");
  const viewInfoEl = document.getElementById("viewInfo");
  const repCountEl = document.getElementById("repCount");          // 횟수/시간 카운터
  const repCountLabelEl = document.getElementById("repCountLabel");
  const setCountEl = document.getElementById("setCount");          // 세트 카운터
  const routineProgressEl = document.getElementById("routineProgress");
  const timerValueEl = document.getElementById("timerValue");      // 타이머 값
  const timerLabelEl = document.getElementById("timerLabel");      // 타이머 라벨
  const restTimerEl = document.getElementById("restTimer");        // 휴식 타이머
  const restValueEl = document.getElementById("restValue");
  const alertContainer = document.getElementById("alertContainer");
  const alertTitle = document.getElementById("alertTitle");
  const alertMessage = document.getElementById("alertMessage");
  const startBtn = document.getElementById("startBtn");
  const originalStartBtnText = startBtn?.textContent?.trim() || "운동 시작";
  const pauseBtn = document.getElementById("pauseBtn");
  const finishBtn = document.getElementById("finishBtn");
  const viewSelectRoot = document.getElementById("viewSelect");    // 뷰(FRONT/SIDE) 선택
  const routineStepEl = document.getElementById("routineStep");
  const plankTargetSelectRoot = document.getElementById("plankTargetSelect");
  const plankTargetInput = document.getElementById("plankTargetSeconds");  // 플랭크 목표 시간 입력
  const plankTargetHint = document.getElementById("plankTargetHint");
  const plankTargetReadoutEl = document.getElementById("plankTargetReadout");
  const plankCurrentHoldEl = document.getElementById("plankCurrentHold");  // 현재 유지 시간
  const plankBestHoldEl = document.getElementById("plankBestHold");        // 최고 유지 시간
  const plankPhaseInfoEl = document.getElementById("plankPhaseInfo");
  const plankProgressEl = document.getElementById("plankProgress");
  const plankStateLabelEl = document.getElementById("plankStateLabel");
  const plankGoalLabelEl = document.getElementById("plankGoalLabel");
  const plankSegmentLabelEl = document.getElementById("plankSegmentLabel");
  // ── 루틴 프로그레스 동적 생성 요소 (setupRoutineProgressUi에서 초기화) ──
  let routineProgressCountEl = null;
  let routineProgressPercentEl = null;
  let routineCurrentExerciseEl = null;
  let routineTargetSummaryEl = null;
  let routineStepListEl = null;

  // ── 유틸리티 함수들 ──

  /** 뷰 코드 정규화: FRONT, SIDE, DIAGONAL만 허용, 나머지는 null */
  const normalizeViewCode = (value) => {
    const normalized = (value || "").toString().trim().toUpperCase();
    return ["FRONT", "SIDE", "DIAGONAL"].includes(normalized)
      ? normalized
      : null;
  };

  /** 플랭크 운동 여부 확인 — 시간 기반 운동 특수 처리 필요 시 사용 */
  const isPlankExerciseCode = (exerciseCode = workoutData.exercise?.code) =>
    (exerciseCode || "").toString().trim().toLowerCase().replace(/-/g, "_") ===
    "plank";

  /** 초 단위 시간을 MM:SS 형식으로 포맷 */
  const formatClock = (totalSeconds) => {
    const safe = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  /** 현재 운동이 시간 기반(플랭크 등)인지 확인 */
  const isTimeBasedExercise = () => Boolean(repCounter?.pattern?.isTimeBased);

  /** 플랭크 목표 시간을 UI 입력에서 읽기 (최소 10초) */
  const readTargetSecFromInput = () => {
    const parsed = Number(plankTargetInput?.value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(10, Math.round(parsed));
  };

  /** 현재 목표 시간(초) 반환 — 루틴 모드면 단계의 target_value, 자유 모드면 state.currentTargetSec */
  const getCurrentTargetSec = () => {
    if (workoutData.mode === "ROUTINE" && workoutData.routine) {
      const step = getCurrentRoutineStep();
      if (normalizeRoutineTargetType(step?.target_type) === "TIME") {
        return Math.max(1, Number(step?.target_value) || 1);
      }
    }

    return Math.max(0, Number(state.currentTargetSec) || 0);
  };

  /** 운동 시작 가능 여부 — 플랭크는 목표 시간이 설정되어야 시작 가능 */
  const canStartCurrentExercise = () => {
    if (!aiReady) return false;
    if (!isPlankExerciseCode()) return true;
    if (workoutData.mode === "ROUTINE") return getCurrentTargetSec() > 0;
    return getCurrentTargetSec() >= 10;
  };

  /** 운동별 허용 뷰(FRONT/SIDE/DIAGONAL) 목록 반환 */
  function getAllowedViews(exercise = workoutData.exercise) {
    const allowed = Array.isArray(exercise?.allowed_views)
      ? exercise.allowed_views
      : [];
    const normalized = allowed
      .map((code) => normalizeViewCode(code))
      .filter(Boolean);
    return normalized.length > 0 ? normalized : ["FRONT"];
  }

  /** 운동의 기본 뷰 결정 — DB 설정优先, 없으면 허용 뷰 중 첫 번째 */
  function resolveDefaultView(exercise = workoutData.exercise) {
    const allowed = getAllowedViews(exercise);
    const defaultView = normalizeViewCode(exercise?.default_view);
    if (defaultView && allowed.includes(defaultView)) return defaultView;
    return allowed[0] || "FRONT";
  }

  /** 루틴 목표 타입 정규화 — DURATION → TIME, 나머지는 REPS/TIME 유지 */
  function normalizeRoutineTargetType(value) {
    const normalized = (value || "").toString().trim().toUpperCase();
    if (normalized === "DURATION") return "TIME";
    return normalized === "TIME" ? "TIME" : "REPS";
  }

  /** 루틴 현재 단계(routine_setup) 반환 */
  function getCurrentRoutineStep() {
    return workoutData.routine?.routine_setup?.[state.currentStepIndex] || null;
  }

  /** 루틴 전체 단계 목록 반환 */
  function getRoutineSteps() {
    return Array.isArray(workoutData.routine?.routine_setup)
      ? workoutData.routine.routine_setup
      : [];
  }

  /** 루틴 단계의 목표 요약 텍스트 생성 (예: "목표 10회 x 3세트") */
  function getRoutineTargetSummary(step = {}) {
    const targetType = normalizeRoutineTargetType(step.target_type);
    const targetValue = Math.max(1, Number(step.target_value) || 1);
    const unit = targetType === "TIME" ? "\uCD08" : "\uD68C";
    const sets = Math.max(1, Number(step.sets) || 1);

    return {
      targetType,
      targetValue,
      unit,
      sets,
      text: `\uBAA9\uD45C ${targetValue}${unit} x ${sets}\uC138\uD2B8`,
    };
  }

  /** 루틴 프로그레스 UI 최초 구성 — 단계 칩 카드를 DOM에 동적 생성 */
  function setupRoutineProgressUi() {
    if (!routineProgressEl || !routineStepEl) return;

    const card = routineProgressEl.closest(".progress-card");
    const progressTrack = routineProgressEl.parentElement;
    const labelEl = card?.querySelector('span.muted:not(#routineStep)');
    if (!card || !progressTrack || !labelEl || card.dataset.enhanced === "true") {
      return;
    }

    card.dataset.enhanced = "true";
    card.classList.add("routine-progress-card");
    progressTrack.classList.add("routine-progress-track");

    const header = document.createElement("div");
    header.className = "routine-progress-header";

    const titleGroup = document.createElement("div");
    titleGroup.className = "routine-progress-title-group";
    routineCurrentExerciseEl = document.createElement("strong");
    routineCurrentExerciseEl.className = "routine-progress-current";
    titleGroup.append(labelEl, routineCurrentExerciseEl);

    const stats = document.createElement("div");
    stats.className = "routine-progress-stats";
    routineProgressCountEl = document.createElement("strong");
    routineProgressCountEl.className = "routine-progress-count";
    routineProgressPercentEl = document.createElement("span");
    routineProgressPercentEl.className = "routine-progress-percent";
    stats.append(routineProgressCountEl, routineProgressPercentEl);

    header.append(titleGroup, stats);

    const meta = document.createElement("div");
    meta.className = "routine-progress-meta";
    routineTargetSummaryEl = document.createElement("span");
    routineTargetSummaryEl.className = "routine-progress-target";
    meta.append(routineStepEl, routineTargetSummaryEl);

    routineStepListEl = document.createElement("div");
    routineStepListEl.className = "routine-step-list";
    routineStepListEl.setAttribute("aria-label", "\uB8E8\uD2F4 \uB2E8\uACC4");

    getRoutineSteps().forEach((step, index) => {
      const chip = document.createElement("div");
      chip.className = "routine-step-chip";
      chip.setAttribute("data-routine-step-index", String(index));

      const chipIndex = document.createElement("span");
      chipIndex.className = "routine-step-index";
      chipIndex.textContent = String(index + 1);

      const chipCopy = document.createElement("div");
      chipCopy.className = "routine-step-copy";

      const chipTitle = document.createElement("strong");
      chipTitle.textContent =
        step?.exercise?.name || `${index + 1}\uBC88\uC9F8 \uC6B4\uB3D9`;

      const chipMeta = document.createElement("span");
      chipMeta.textContent = getRoutineTargetSummary(step).text;

      chipCopy.append(chipTitle, chipMeta);
      chip.append(chipIndex, chipCopy);
      routineStepListEl.append(chip);
    });

    card.replaceChildren(header, progressTrack, meta, routineStepListEl);
  }

  /** 루틴 현재 단계가 시간 기반 목표인지 확인 */
  function isRoutineTimeTarget() {
    if (workoutData.mode !== "ROUTINE" || !workoutData.routine) return false;
    const step = getCurrentRoutineStep();
    return normalizeRoutineTargetType(step?.target_type) === "TIME";
  }

  /** 메인 카운터 UI 업데이트 — 시간 기반이면 초, 횟수 기반이면 rep 수 표시 */
  function updatePrimaryCounterDisplay() {
    if (repCountLabelEl) {
      repCountLabelEl.textContent =
        isTimeBasedExercise() || isRoutineTimeTarget()
          ? "\uC2DC\uAC04(\uCD08)"
          : "\uD69F\uC218";
    }

    const value = isTimeBasedExercise()
      ? Math.max(0, Math.round(state.currentSegmentSec))
      : isRoutineTimeTarget()
        ? Math.max(0, Math.round(state.currentSetWorkSec))
        : Math.max(0, Math.round(state.currentRep));
    repCountEl.textContent = String(value);
  }

  /** 루틴 단계 프로그레스 표시 업데이트 — 현재 단계/전체, 완료 칩 하이라이트 */
  function updateRoutineStepDisplay() {
    if (
      !routineStepEl ||
      workoutData.mode !== "ROUTINE" ||
      !workoutData.routine
    )
      return;

    setupRoutineProgressUi();

    const steps = getRoutineSteps();
    if (steps.length === 0) return;

    const stepIndex = Math.min(state.currentStepIndex, steps.length - 1);
    const step = steps[stepIndex] || {};
    const targetSummary = getRoutineTargetSummary(step);
    const completedSteps = Math.min(
      Math.max(0, state.currentStepIndex),
      steps.length,
    );
    const progressPercent = Math.round((completedSteps / steps.length) * 100);

    routineStepEl.textContent = `\uD604\uC7AC ${stepIndex + 1} / ${steps.length} \uC6B4\uB3D9`;

    if (routineProgressEl) {
      routineProgressEl.style.width = `${progressPercent}%`;
    }
    if (routineProgressCountEl) {
      routineProgressCountEl.textContent = `${stepIndex + 1} / ${steps.length}`;
    }
    if (routineProgressPercentEl) {
      routineProgressPercentEl.textContent = `${progressPercent}%`;
    }
    if (routineCurrentExerciseEl) {
      routineCurrentExerciseEl.textContent =
        step?.exercise?.name || `${stepIndex + 1}\uBC88\uC9F8 \uC6B4\uB3D9`;
    }
    if (routineTargetSummaryEl) {
      routineTargetSummaryEl.textContent = targetSummary.text;
    }
    if (routineStepListEl) {
      routineStepListEl
        .querySelectorAll("[data-routine-step-index]")
        .forEach((chip) => {
          const chipIndex = Number(chip.getAttribute("data-routine-step-index"));
          chip.classList.toggle("is-complete", chipIndex < stepIndex);
          chip.classList.toggle("is-active", chipIndex === stepIndex);
          chip.classList.toggle("is-upcoming", chipIndex > stepIndex);

          if (chipIndex === stepIndex) {
            chip.setAttribute("aria-current", "step");
          } else {
            chip.removeAttribute("aria-current");
          }
        });
    }
  }

  /**
   * 플랭크 목표 시간 UI 동기화
   * - 루틴 모드: 자동 적용 (버튼/입력 비활성화)
   * - 자유 모드: 수동 선택 (PREPARING 상태에서만)
   */
  function syncPlankTargetUi() {
    const targetSec = getCurrentTargetSec();
    const isPlank = isPlankExerciseCode();
    const isRoutinePlank = isPlank && workoutData.mode === "ROUTINE";
    const showFreeTargetUi =
      isPlank && workoutData.mode !== "ROUTINE" && state.phase === "PREPARING";

    if (plankTargetSelectRoot) {
      plankTargetSelectRoot.hidden = !showFreeTargetUi;
      plankTargetSelectRoot
        .querySelectorAll("[data-plank-target-sec]")
        .forEach((button) => {
          const buttonSec = Number(
            button.getAttribute("data-plank-target-sec"),
          );
          button.classList.toggle("active", buttonSec === targetSec);
          button.disabled = isRoutinePlank;
        });
    }

    if (plankTargetInput) {
      if (targetSec > 0) {
        plankTargetInput.value = String(targetSec);
      }
      plankTargetInput.disabled = isRoutinePlank;
    }

    if (plankTargetHint) {
      plankTargetHint.textContent = isRoutinePlank
        ? `루틴 목표 시간 ${targetSec}초가 자동으로 적용됩니다.`
        : "플랭크는 목표 시간을 먼저 정한 뒤 시작합니다. 목표 시간은 세션 종료 시 점수 정규화 기준이 됩니다.";
    }

    if (plankTargetReadoutEl) {
      plankTargetReadoutEl.textContent =
        targetSec > 0 ? `${targetSec}초` : "--";
    }

    if (scoreModeLabelEl) {
      scoreModeLabelEl.textContent = isPlank
        ? "현재 자세 점수"
        : "이번 rep 점수";
    }
    if (timerLabelEl) {
      timerLabelEl.textContent = isPlank ? "플랭크 시간" : "운동 시간";
    }
    if (startBtn && state.phase === "PREPARING") {
      startBtn.textContent = isPlank ? "플랭크 시작" : "운동 시작";
    }
  }

  /**
   * 목표 시간(초) 적용 — state 및 RepCounter에 반영 후 UI 갱신
   * - state.currentTargetSec: 세션 목표 시간 저장
   * - repCounter.setTargetSec(): RepCounter에 목표 시간 전달
   * - syncPlankTargetUi(): UI 동기화
   * - updatePlankRuntimeDisplay(): 플랭크 런타임 표시 갱신
   */
  function applyTargetSec(nextTargetSec) {
    const parsed = Number(nextTargetSec);
    state.currentTargetSec =
      Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
    if (repCounter?.setTargetSec) {
      repCounter.setTargetSec(state.currentTargetSec);
    }
    syncPlankTargetUi();
    updatePlankRuntimeDisplay(
      repCounter?.getTimeSummary ? repCounter.getTimeSummary() : null,
    );
    if (startBtn && !startBtn.hidden) {
      startBtn.disabled = !canStartCurrentExercise();
    }
  }

  /**
   * 플랭크 목표 시간 선택 버튼/입력 이벤트 바인딩
   * - 프리셋 버튼(30/60/90/120초) 클릭 → applyTargetSec()
   * - 직접 입력 → applyTargetSec()
   */
  function setupPlankTargetControls() {
    if (!plankTargetSelectRoot) return;

    plankTargetSelectRoot
      .querySelectorAll("[data-plank-target-sec]")
      .forEach((button) => {
        button.addEventListener("click", () => {
          if (workoutData.mode === "ROUTINE") return;
          const targetSec = Number(
            button.getAttribute("data-plank-target-sec"),
          );
          applyTargetSec(targetSec);
        });
      });

    if (plankTargetInput) {
      plankTargetInput.addEventListener("change", () => {
        if (workoutData.mode === "ROUTINE") return;
        applyTargetSec(readTargetSecFromInput());
      });
      plankTargetInput.addEventListener("input", () => {
        if (workoutData.mode === "ROUTINE") return;
        const nextValue = Number(plankTargetInput.value);
        if (!Number.isFinite(nextValue) || nextValue < 10) return;
        applyTargetSec(nextValue);
      });
    }
  }

  /**
   * 플랭크 실시간 표시 업데이트 — 현재 유지 시간, 최고 시간, 진행률, phase 라벨
   * summary: RepCounter.getTimeSummary() 결과
   *   - currentHoldSec: 현재 유지 시간
   *   - bestHoldSec: 최고 유지 시간
   *   - currentHoldScore: 현재 자세 점수
   *   - currentPhase: SETUP/HOLD/BREAK
   */
  function updatePlankRuntimeDisplay(summary = null) {
    const isPlank = isPlankExerciseCode();
    const wrapperIds = ["plankRuntimePanel", "plankTimerPanel"];
    wrapperIds.forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.hidden = !isPlank;
      }
    });

    if (!isPlank) return;

    const phase = summary?.currentPhase || window.TIME_PHASES?.SETUP || "SETUP";
    const currentSegmentSec = Math.max(
      0,
      Math.floor((summary?.currentSegmentMs || 0) / 1000),
    );
    const bestHoldSec = Math.max(0, Math.floor(summary?.bestHoldSec || 0));
    const targetSec = getCurrentTargetSec();
    const progressRatio =
      targetSec > 0 ? Math.min(1, bestHoldSec / targetSec) : 0;

    state.currentSegmentSec = currentSegmentSec;
    state.bestHoldSec = bestHoldSec;
    state.plankGoalReached = targetSec > 0 && bestHoldSec >= targetSec;

    if (plankCurrentHoldEl)
      plankCurrentHoldEl.textContent = formatClock(currentSegmentSec);
    if (plankBestHoldEl) plankBestHoldEl.textContent = formatClock(bestHoldSec);
    if (plankPhaseInfoEl) plankPhaseInfoEl.textContent = phase;
    if (plankStateLabelEl) plankStateLabelEl.textContent = phase;
    if (plankSegmentLabelEl)
      plankSegmentLabelEl.textContent = formatClock(currentSegmentSec);
    if (plankTargetReadoutEl)
      plankTargetReadoutEl.textContent =
        targetSec > 0 ? `${targetSec}초` : "--";
    if (plankGoalLabelEl) {
      plankGoalLabelEl.textContent = state.plankGoalReached
        ? "달성"
        : targetSec > 0
          ? `${Math.max(0, targetSec - bestHoldSec)}초 남음`
          : "대기 중";
    }
    if (plankProgressEl) {
      plankProgressEl.style.width = `${Math.round(progressRatio * 100)}%`;
    }
  }

  /** 루틴 카운터/프로그레스 전체 새로고침 — 단계 표시 + 프로그레스 바 */
  function refreshRoutineCounterUi() {
    updatePrimaryCounterDisplay();
    updateRoutineStepDisplay();
    updatePlankRuntimeDisplay(
      repCounter?.getTimeSummary ? repCounter.getTimeSummary() : null,
    );
  }

  let isEndingSession = false;
  let pendingSessionPayload = null;
  let hasUnloadAbortSent = false;
  let aiEnginesInitialized = false;
  let aiReady = false;
  let warmUpGeneration = 0;
  let aiInitPromise = null;
  let selectedCameraSource = window.SESSION_CAMERA_DEFAULT_SOURCE || "screen";
  const sessionCamera = new SessionCamera(videoElement, poseCanvas);
  let wakeLock = null;

  /**
   * 카메라 프리뷰 방향(미러링 등) 적용
   * - webcam: 미러링 (사용자가 거울처럼 보도록)
   * - mobile_front: 미러링
   * - mobile_rear: 미러링 없음
   * - screen: 미러링 없음
   */
  function applyPreviewOrientation(sourceType) {
    if (!cameraFrame) return;
    cameraFrame.setAttribute(
      "data-preview-mirrored",
      shouldMirrorSourcePreview(sourceType) ? "true" : "false",
    );
  }

  /** 화면 꺼짐 방지 Wake Lock 요청 (운동 중 화면 유지) */
  async function requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          console.log("[Wake Lock] Screen Wake Lock released");
        });
        console.log("[Wake Lock] Screen Wake Lock acquired");
      }
    } catch (err) {
      console.error(`[Wake Lock] Error: ${err.name}, ${err.message}`);
    }
  }

  /** Wake Lock 해제 — 운동 종료/일시정지 시 호출 */
  async function releaseWakeLock() {
    if (wakeLock !== null) {
      await wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  document.addEventListener("visibilitychange", async () => {
    if (
      document.visibilityState === "visible" &&
      (state.phase === "WORKING" || state.phase === "RESTING")
    ) {
      await requestWakeLock();
    }
  });

  const cameraReadyHtml =
    '<p>준비 완료</p><p class="muted">전신이 잘 보이도록 위치를 조정하세요</p>';

  // ── 품질 게이트 추적 상태 ──
  // noPersonCount: 카메라에서 사람 미감지 프레임 누적
  // NO_PERSON_THRESHOLD: 이 프레임 수 이상 미감지 시 경고
  // qualityGateTracker: 점수 산출 보류(withhold) 여부와 안정 프레임 수 추적
  let noPersonCount = 0;
  const NO_PERSON_THRESHOLD = 30;
  let qualityGateTracker = {
    stableFrameCount: 0,
    recentStabilityWindow: [],
    isWithholding: false,
    withholdReason: null,
  };
  state.selectedView =
    normalizeViewCode(workoutData.selectedView) || resolveDefaultView();
  state.currentTargetSec = Math.max(0, Number(workoutData.plankTargetSec) || 0);

  /** 현재 운동 코드 반환 (정규화: 대소문자, 하이픈→언더스코어) */
  function getCurrentExerciseCode() {
    return ((workoutData.exercise && workoutData.exercise.code) || "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/-/g, "_");
  }

  /** ScoringEngine/RepCounter를 현재 운동에 바인딩 — 운동 변경 시(루틴 단계 전환) 재호출 */
  function bindEnginesToCurrentExercise() {
    if (!workoutData.exercise) {
      return false;
    }

    scoringEngine = new ScoringEngine(workoutData.scoringProfile || null, {
      exerciseCode: workoutData.exercise.code,
      selectedView: state.selectedView,
    });
    exerciseModule =
      window.WorkoutExerciseRegistry?.get(workoutData.exercise.code) || null;

    repCounter = new RepCounter(workoutData.exercise.code);
    repCounter.repEvaluator = (repRecord) => scoringEngine.scoreRep(repRecord);
    repCounter.onRepComplete = handleRepComplete;
    if (repCounter?.pattern?.isTimeBased && repCounter?.setTargetSec) {
      repCounter.setTargetSec(getCurrentTargetSec());
    }
    return true;
  }

  /** 현재 운동 런타임 컨텍스트 반환 — 운동 모듈에서 접근용 */
  function getExerciseRuntime(extra = {}) {
    return {
      exerciseCode: getCurrentExerciseCode(),
      exerciseModule,
      repCounter,
      scoringEngine,
      selectedView: state.selectedView,
      state,
      ...extra,
    };
  }

  // REMOVED: getFrameGateResult — gate authority belongs exclusively to scoring-engine.js
  // The common quality gate (evaluateQualityGate) is the sole pass/withhold decision-maker.
  // Exercise modules must not emit gating decisions (spec §3.1, §3.2).

  /**
   * AI 엔진 초기화 — 세션 시작 전 최초 1회 호출
   * 1. PoseEngine 생성 + MediaPipe 초기화
   * 2. bindEnginesToCurrentExercise()로 ScoringEngine/RepCounter 바인딩
   * 3. onPoseDetected / onNoPerson 콜백 연결
   */
  async function initAIEngines() {
    try {
      poseEngine = new PoseEngine();
      await poseEngine.initialize();

      if (!bindEnginesToCurrentExercise()) {
        throw new Error("운동 정보를 불러오지 못했습니다.");
      }

      poseEngine.onPoseDetected = handlePoseDetected;
      poseEngine.onNoPerson = handleNoPerson;

      console.log("[Session] AI 엔진 초기화 완료");
      return true;
    } catch (error) {
      console.error("[Session] AI 엔진 초기화 실패:", error);
      return false;
    }
  }

  /**
   * 카메라/화면 공유 스트림 연결
   * sourceType: 'webcam' | 'screen' | 'mobile_front' | 'mobile_rear'
   * 스트림 획득 → 비디오 요소에 바인딩 → 세션 시작 버튼 활성화
   */
  async function connectCameraSource(sourceType) {
    applyPreviewOrientation(sourceType);
    cameraOverlay.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
        <style>@keyframes spin-anim { 100% { transform: rotate(360deg); } }</style>
        <div style="width:36px; height:36px; border:4px solid rgba(255,255,255,0.2); border-top-color:#fff; border-radius:50%; animation:spin-anim 1s linear infinite;"></div>
        <p style="margin:0; font-weight:500;">카메라를 연결 중...</p>
      </div>
    `;
    cameraOverlay.hidden = false;
    startBtn.disabled = true;
    startBtn.textContent = "모델 준비 중...";
    aiReady = false;

    try {
      sessionCamera.destroy();
      const stream = await sessionCamera.getStream(sourceType);
      sessionCamera.applyStream(stream);

      await new Promise((resolve) => {
        if (videoElement.readyState >= 2) resolve();
        else
          videoElement.addEventListener("loadeddata", resolve, { once: true });
      });

      cameraOverlay.hidden = true;

      warmUpGeneration++;
      prepareAI(warmUpGeneration);
    } catch (error) {
      console.error("[Session] 카메라 에러:", error);

      let userMessage = "권한을 확인하거나 다른 입력 소스를 선택해 주세요";
      if (
        error.name === "NotFoundError" ||
        error.name === "DevicesNotFoundError"
      ) {
        userMessage =
          "카메라가 감지되지 않았습니다. 다른 입력 소스를 선택해 주세요";
      } else if (
        error.name === "NotAllowedError" ||
        error.name === "PermissionDeniedError"
      ) {
        userMessage =
          "카메라 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요";
      } else if (
        error.name === "NotReadableError" ||
        error.name === "TrackStartError"
      ) {
        userMessage =
          "카메라를 열 수 없습니다. 다른 프로그램이 카메라를 사용 중이거나 드라이버 문제일 수 있습니다";
      } else if (error.name === "AbortError") {
        userMessage = "사용자가 취소했습니다. 입력 소스를 다시 선택해 주세요";
      }

      cameraOverlay.innerHTML = `<p>미디어 연결 실패</p><p class="muted">${userMessage}</p>`;
      startBtn.disabled = true;
    }
  }

  async function prepareAI(generation) {
    if (!aiEnginesInitialized) {
      if (!aiInitPromise) {
        aiInitPromise = initAIEngines();
      }
      const ok = await aiInitPromise;
      aiInitPromise = null;
      if (generation !== warmUpGeneration) return;
      if (!ok) {
        cameraOverlay.hidden = false;
        cameraOverlay.innerHTML =
          '<p>AI 엔진 로딩 실패</p><p class="muted">페이지를 새로고침해주세요</p>';
        startBtn.textContent = originalStartBtnText;
        return;
      }
      aiEnginesInitialized = true;
    }

    if (generation !== warmUpGeneration) return;

    aiReady = true;
    startBtn.disabled = !canStartCurrentExercise();
    startBtn.textContent = originalStartBtnText;
    cameraOverlay.innerHTML = cameraReadyHtml;
    cameraOverlay.hidden = false;
  }

  /**
   * 카메라 소스 선택 버튼(웹캠/화면공유/후면) 이벤트 바인딩
   * 선택 시 connectCameraSource() 호출 → 스트림 연결
   */
  function setupSourceSelectors() {
    const root = document.getElementById("sourceSelect");
    if (!root) return;

    root.querySelectorAll("[data-source]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (state.phase !== "PREPARING") return;
        const next = btn.getAttribute("data-source");
        if (!next || next === selectedCameraSource) return;
        selectedCameraSource = next;
        root.querySelectorAll("[data-source]").forEach((b) => {
          b.classList.toggle(
            "active",
            b.getAttribute("data-source") === selectedCameraSource,
          );
        });
        await connectCameraSource(selectedCameraSource);
      });
    });

    root.querySelectorAll("[data-source]").forEach((b) => {
      b.classList.toggle(
        "active",
        b.getAttribute("data-source") === selectedCameraSource,
      );
    });
  }

  /**
   * 선택된 뷰(FRONT/SIDE/DIAGONAL) 적용 — ScoringEngine에도 반영
   * - scoringEngine.setSelectedView(): 채점 엔진에 뷰 정보 전달
   * - state.selectedView: 세션 상태에 저장
   */
  function applySelectedView(nextView) {
    const normalized = normalizeViewCode(nextView);
    const allowed = getAllowedViews();
    const fallback = resolveDefaultView();
    state.selectedView =
      normalized && allowed.includes(normalized) ? normalized : fallback;

    if (!viewSelectRoot) return;

    viewSelectRoot.querySelectorAll("[data-view]").forEach((btn) => {
      btn.classList.toggle(
        "active",
        btn.getAttribute("data-view") === state.selectedView,
      );
    });
  }

  /**
   * 뷰 선택 버튼(FRONT/SIDE/DIAGONAL) 이벤트 바인딩
   * 선택 시 applySelectedView() → ScoringEngine에 반영
   */
  function setupViewSelectors() {
    if (!viewSelectRoot) return;
    applySelectedView(state.selectedView);

    viewSelectRoot.querySelectorAll("[data-view]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (state.phase !== "PREPARING") return;
        const next = btn.getAttribute("data-view");
        if (!next) return;
        applySelectedView(next);
        if (scoringEngine?.setSelectedView) {
          scoringEngine.setSelectedView(state.selectedView);
        }
      });
    });
  }

  /**
   * 세션 버퍼 초기화 — 새 세션 시작 또는 루틴 단계 전환 시 호출
   * SessionBuffer 인스턴스를 새로 생성하고 localStorage 백업 키 설정
   */
  function resetSessionBufferForSession(nextSessionId, options = {}) {
    const normalizedSessionId = Number(nextSessionId);
    if (!Number.isFinite(normalizedSessionId) || normalizedSessionId <= 0) {
      return;
    }

    const nextSelectedView = normalizeViewCode(options.selectedView);
    if (nextSelectedView) {
      state.selectedView = nextSelectedView;
    }

    const exerciseCode =
      options.exerciseCode ||
      workoutData.exercise?.code ||
      "unknown";

    if (sessionBuffer) {
      sessionBuffer.clearStorage();
    }

    state.sessionId = normalizedSessionId;
    pendingSessionPayload = null;
    hasUnloadAbortSent = false;

    sessionBuffer = new SessionBuffer(state.sessionId, {
      exerciseCode,
      mode: workoutData.mode,
      selectedView: state.selectedView,
      resultBasis: repCounter?.pattern?.isTimeBased ? "DURATION" : "REPS",
      targetSec: Number.isFinite(Number(options.targetSec))
        ? Number(options.targetSec)
        : getCurrentTargetSec() || null,
    });

    sessionBuffer.addEvent("SESSION_START", {
      exercise: exerciseCode,
      selected_view: state.selectedView,
      source: options.source || "SESSION_RESET",
    });
  }

  /**
   * 운동 세션 시작 — 프리/루틴 공통 진입점
   * 1. 서버에 POST /api/workout/session — 세션 생성 (sessionId 획득)
   * 2. SessionBuffer 초기화 (localStorage 백업 키 설정)
   * 3. 포즈 감지 루프(startPoseDetection) 시작
   * 4. 타이머 시작, Wake Lock 획득
   * 5. 루틴 모드면 첫 단계 UI 표시
   */
  async function startWorkout() {
    const prevOverlayHtml = cameraOverlay.innerHTML;
    const prevOverlayHidden = cameraOverlay.hidden;
    const prevStartHidden = startBtn.hidden;
    const prevStartDisabled = startBtn.disabled;
    const prevStartText = startBtn.textContent;

    cameraOverlay.hidden = true;
    startBtn.hidden = true;
    startBtn.disabled = true;

    if (!state.selectedView) {
      state.selectedView = resolveDefaultView();
    }

    if (!aiReady) {
      alert("AI 모델이 아직 준비 중입니다. 잠시 후 다시 시도해주세요.");
      cameraOverlay.hidden = prevOverlayHidden;
      cameraOverlay.innerHTML = prevOverlayHtml || cameraReadyHtml;
      startBtn.hidden = prevStartHidden;
      startBtn.disabled = prevStartDisabled;
      return;
    }

    if (!canStartCurrentExercise()) {
      alert("목표 시간을 먼저 설정해주세요.");
      return;
    }

    try {
      const response = await fetch("/api/workout/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          exercise_id: workoutData.exercise.exercise_id,
          selected_view: state.selectedView,
          mode: workoutData.mode,
          routine_id: workoutData.routine?.routine_id || null,
          target_sec: getCurrentTargetSec() || null,
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          data.error || data.message || "세션 시작에 실패했습니다.",
        );
      }

      state.sessionId = data.session.session_id;
      state.selectedView =
        normalizeViewCode(data.session.selected_view) || state.selectedView;
      hasUnloadAbortSent = false;
      pendingSessionPayload = null;
      if (data.routineInstance) {
        workoutData.routineInstance = data.routineInstance;
      }
      state.phase = "WORKING";
      syncPlankTargetUi();
      refreshRoutineCounterUi();

      resetSessionBufferForSession(state.sessionId, {
        exerciseCode: workoutData.exercise.code,
        selectedView: state.selectedView,
        targetSec: getCurrentTargetSec() || null,
        source: "SESSION_START",
      });
      state.currentTargetSec = getCurrentTargetSec();

      updateStatus("running", "운동 중");
      cameraOverlay.hidden = true;
      startBtn.hidden = true;
      const sourceSelectEl = document.getElementById("sourceSelect");
      if (sourceSelectEl) sourceSelectEl.hidden = true;
      if (viewSelectRoot) viewSelectRoot.hidden = true;
      if (plankTargetSelectRoot) plankTargetSelectRoot.hidden = true;

      const setupPanelContainer = document.getElementById(
        "setupPanelContainer",
      );
      if (setupPanelContainer)
        setupPanelContainer.classList.add("hidden-during-workout");

      pauseBtn.disabled = false;
      finishBtn.disabled = false;
      finishBtn.textContent = "운동 종료";

      startTimer();
      startPoseDetection();
      await requestWakeLock();
    } catch (error) {
      console.error("[Session] 시작 에러:", error);
      cameraOverlay.hidden = prevOverlayHidden;
      cameraOverlay.innerHTML = prevOverlayHtml || cameraReadyHtml;
      startBtn.hidden = prevStartHidden;
      startBtn.disabled = prevStartDisabled;
      startBtn.textContent = prevStartText;
      alert("운동 시작에 실패했습니다: " + error.message);
    }
  }

  /**
   * 포즈 감지 루프 시작 — requestAnimationFrame으로 매 프레임 poseEngine.send(video) 호출
   * - poseEngine.start(): MediaPipe 파이프라인 시작
   * - processFrame(): 비디오 프레임 전송 → 랜드마크 추론 → 캔버스에 랜드마크 오버레이
   * - state.isPaused: 일시정지 시 프레임 전송 중단 (루프 자체는 유지)
   */
  function startPoseDetection() {
    if (!poseEngine) return;

    poseEngine.start();

    const processFrame = async () => {
      try {
        if (poseEngine && poseEngine.isRunning && !state.isPaused) {
          await poseEngine.send(videoElement);

          if (poseEngine.lastResults) {
            poseEngine.drawPose(poseCanvas, poseEngine.lastResults);
          }
        }
      } catch (error) {
        console.error('[Session] processFrame 예외:', error);
      }

      if (state.phase !== "FINISHED") {
        state.frameLoop = requestAnimationFrame(processFrame);
      }
    };

    state.frameLoop = requestAnimationFrame(processFrame);
    console.log("[Session] 포즈 감지 시작");
  }

  /**
   * 포즈 감지 콜백 — 매 프레임마다 PoseEngine에서 호출됨
   * 핵심 처리 흐름:
   *   1. 품질 게이트 평가 → 통과 못하면 점수 억제(withhold) 후 return
   *      - isFrameStable(): 프레임 안정성 확인 (LOW 품질이거나 뷰 안정성 < 0.5면 불안정)
   *      - updateQualityGateTracker(): 최근 12프레임 안정성 비율 + 연속 안정 프레임 수
   *      - buildGateInputsFromPoseData(): PoseEngine 품질 데이터 → 게이트 입력 표준화
   *      - evaluateQualityGate(): 게이트 통과/보류 결정 (ScoringEngine 공통 게이트)
   *      - shouldSuppressScoring(): withhold면 즉시 true, 아니면 안정 프레임 threshold 확인
   *   2. ScoringEngine.calculate(angles) → 점수 산출
   *   3. RepCounter.update(angles, score) → 반복/시간 감지
   *   4. UI 업데이트 (점수, 카운터, 피드백, 뷰 정보)
   *   5. SessionBuffer.addScore() → 타임라인 기록
   */
  function handlePoseDetected(poseData) {
    noPersonCount = 0;

    if (state.phase !== "WORKING" || state.isPaused) return;

    const { angles } = poseData;
    // updateViewInfo(angles);

    const stabilityMetrics = updateQualityGateTracker(poseData, qualityGateTracker);
    const gateInputs = buildGateInputsFromPoseData(poseData, stabilityMetrics);
    const gateContext = {
      allowedViews: getAllowedViews(),
      // selectedView is the user-chosen scoring camera angle for this session.
      // The common quality gate must enforce it when present.
      selectedView: state.selectedView,
    };
    const gateResult = (typeof evaluateQualityGate !== 'undefined')
      ? evaluateQualityGate(gateInputs, gateContext)
      : { result: 'pass', reason: null };
    const gateThreshold = (typeof QUALITY_GATE_THRESHOLDS !== 'undefined')
      ? QUALITY_GATE_THRESHOLDS.stableFrameCount
      : 8;
    const suppression = shouldSuppressScoring(gateResult, qualityGateTracker, gateThreshold);

    if (suppression.suppress) {
      state.pauseRepScoring = true;
      state.currentWithholdReason = suppression.reason;
      if (isTimeBasedExercise() && repCounter?.handleTimeBreak) {
        repCounter.handleTimeBreak("QUALITY_GATE");
        updatePlankRuntimeDisplay(repCounter.getTimeSummary());
        updatePrimaryCounterDisplay();
      }
      if (poseEngine && poseEngine.setVisualFeedback) {
        poseEngine.setVisualFeedback([]);
      }
      updateScoreDisplay({
        score: 0,
        breakdown: [],
        gated: true,
        message: mapWithholdReasonToMessage(suppression.reason),
      });
      showAlert("자세 인식 대기", mapWithholdReasonToMessage(suppression.reason));
      if (sessionBuffer) {
        sessionBuffer.addEvent("QUALITY_GATE_WITHHOLD", {
          reason: suppression.reason,
          stableFrameCount: stabilityMetrics.stableFrameCount,
        });
      }
      return;
    }

    state.pauseRepScoring = false;
    state.currentWithholdReason = null;

    // REMOVED: exercise module frame gate — authority consolidated in scoring-engine.js
    // The quality gate (evaluateQualityGate) above already decides pass/withhold.
    // If gate passes, proceed directly to scoring.

    const rawScoreResult = scoringEngine.calculate(angles);
    const liveScoreResult = getLiveFeedbackResult(rawScoreResult, angles);
    const scoreForState = isTimeBasedExercise()
      ? liveScoreResult.score
      : rawScoreResult.score;

    const previousCounts = {
      all: repCounter?.currentRepAllScores?.length || 0,
      active: repCounter?.currentRepScores?.length || 0,
      movement: repCounter?.currentMovementScores?.length || 0,
    };
    const timeOrRepResult = repCounter.update(angles, scoreForState);
    // updateViewInfo(angles);

    if (isTimeBasedExercise()) {
      updatePlankRuntimeDisplay(timeOrRepResult || repCounter.getTimeSummary());
      updatePrimaryCounterDisplay();
    }
    syncRepCounterLatestScores(liveScoreResult.score, previousCounts);

    if (poseEngine && poseEngine.setVisualFeedback) {
      poseEngine.setVisualFeedback(liveScoreResult.breakdown);
    }

    if (liveScoreResult.score > 0) {
      console.log(
        "[Session] 점수:",
        liveScoreResult.score,
        "breakdown:",
        liveScoreResult.breakdown?.length,
      );
    }

    updateRepMetricBuffer(liveScoreResult);

    updateScoreDisplay(liveScoreResult);

    if (sessionBuffer) {
      sessionBuffer.addScore(liveScoreResult);
    }

    const shouldCheckFeedback = repCounter?.pattern?.isTimeBased
      ? true
      : repCounter?.isInProgress();
    if (shouldCheckFeedback) {
      checkFeedback(liveScoreResult);
    }
  }

  /**
   * 사람 미감지 콜백 — PoseEngine에서 landmarks가 없을 때 호출
   * - 시간 기반 운동(플랭크): handleTimeBreak("NO_PERSON") → 브레이크 처리
   * - NO_PERSON_THRESHOLD(30프레임) 초과 시 이벤트 로그 + 알림
   */
  function handleNoPerson() {
    if (state.phase !== "WORKING" || state.isPaused) return;

    noPersonCount++;

    if (isTimeBasedExercise() && repCounter?.handleTimeBreak) {
      repCounter.handleTimeBreak("NO_PERSON");
      updatePlankRuntimeDisplay(repCounter.getTimeSummary());
      updatePrimaryCounterDisplay();
    }

    if (noPersonCount === NO_PERSON_THRESHOLD) {
      if (sessionBuffer) {
        sessionBuffer.addEvent("NO_PERSON", {
          duration: noPersonCount,
          message: "카메라에 사람이 감지되지 않습니다",
        });
      }
      showAlert("감지 안됨", "카메라에 전신이 보이도록 해주세요");
    }
  }

  /** 점수 배열의 평균 계산 — null/undefined/Infinity 제외 후 산술 평균 */
  function aggregateScores(scores) {
    if (!scores || scores.length === 0) return 0;
    const sorted = scores
      .filter((s) => typeof s === "number" && !Number.isNaN(s))
      .slice()
      .sort((a, b) => a - b);
    if (sorted.length === 0) return 0;

    const trimCount = Math.floor(sorted.length * 0.1);
    const trimmed =
      sorted.length >= 10
        ? sorted.slice(trimCount, sorted.length - trimCount)
        : sorted;
    const sum = trimmed.reduce((a, b) => a + b, 0);
    return Math.round(sum / trimmed.length);
  }

  /**
   * 메트릭 항목을 0~100 정규화 점수로 변환
   * - normalizedScore가 있으면 사용, 없으면 score/maxScore 비율로 계산
   */
  function getNormalizedMetricScore(item) {
    const explicit = Number(item?.normalizedScore ?? item?.normalized_score);
    if (Number.isFinite(explicit)) {
      return Math.max(0, Math.min(100, explicit));
    }

    const rawScore = Number(item?.score ?? item?.avg_score);
    const rawMaxScore = Number(item?.maxScore ?? item?.max_score);
    if (Number.isFinite(rawScore) && Number.isFinite(rawMaxScore) && rawMaxScore > 0) {
      return Math.max(0, Math.min(100, (rawScore / rawMaxScore) * 100));
    }

    return Number.isFinite(rawScore) ? Math.max(0, Math.min(100, rawScore)) : 0;
  }

  /**
   * ScoringEngine 점수를 RepCounter의 운동 모듈에도 동기화
   * - 운동 모듈의 recordFrame()에 점수 전달 (phase 기반 채점용)
   * - 이전 카운트와 비교해 rep 완료 여부 확인 → handleRepComplete 트리거
   */
  function syncRepCounterLatestScores(score, previousCounts) {
    if (!repCounter || !Number.isFinite(score)) return;

    const targets = [
      {
        list: repCounter.currentRepAllScores,
        previous: previousCounts?.all || 0,
      },
      {
        list: repCounter.currentRepScores,
        previous: previousCounts?.active || 0,
      },
      {
        list: repCounter.currentMovementScores,
        previous: previousCounts?.movement || 0,
      },
    ];

    for (const target of targets) {
      if (!Array.isArray(target.list)) continue;
      if (target.list.length > target.previous) {
        target.list[target.list.length - 1] = score;
      }
    }
  }

  /**
   * 실시간 피드백 결과 생성
   * - 시간 기반 운동: 정규화된 점수로 변환 (poseEngine.getQualityFactor 보정)
   * - 횟수 기반 운동: raw scoreResult 그대로 사용
   * - breakdown에 시각 피드백 정보 추가 (poseEngine용)
   */
  function getLiveFeedbackResult(scoreResult, angles) {
    if (!scoreResult?.breakdown?.length) {
      return scoreResult;
    }

    if (exerciseModule?.filterLiveFeedback) {
      return (
        exerciseModule.filterLiveFeedback(
          scoreResult,
          getExerciseRuntime({ angles }),
        ) || scoreResult
      );
    }

    return scoreResult;
  }

  /**
   * rep별 메트릭 점수를 버퍼에 누적 — rep 완료 시 요약에 사용
   * - breakdown의 각 메트릭을 state.repMetricBuffer에 scores 배열로 누적
   * - rep 완료 시 handleRepComplete에서 이 버퍼를 기반으로 최종 요약 생성
   */
  function updateRepMetricBuffer(scoreResult) {
    const isTimeBased = repCounter?.pattern?.isTimeBased;
    if (isTimeBased) return;

    const isRepInProgress = repCounter?.isInProgress
      ? repCounter.isInProgress()
      : false;
    if (isRepInProgress && !state.repInProgressPrev) {
      state.repMetricBuffer = {};
    }
    state.repInProgressPrev = isRepInProgress;

    if (!isRepInProgress) return;
    if (exerciseModule?.shouldAccumulateRepMetrics) {
      if (
        !exerciseModule.shouldAccumulateRepMetrics(
          getExerciseRuntime({ scoreResult }),
        )
      )
        return;
    } else if (repCounter?.currentState !== window.REP_STATES?.ACTIVE) {
      return;
    }

    if (!scoreResult?.breakdown || scoreResult.breakdown.length === 0) return;
    for (const item of scoreResult.breakdown) {
      const key = item.key;
      if (!key) continue;
      if (!state.repMetricBuffer[key]) {
        state.repMetricBuffer[key] = {
          metric_id: item.metric_id,
          key,
          title: item.title || key,
          maxScore: 100,
          scores: [],
        };
      }
      state.repMetricBuffer[key].scores.push(getNormalizedMetricScore(item));
    }
  }

  /**
   * 감지된 뷰(FRONT/SIDE/DIAGONAL) 정보를 UI에 표시 — 쓰로틀 적용 (1초에 1회)
   * - angles.view: PoseEngine의 classifyView() 결과
   * - angles.quality.viewStability: 뷰 안정성 점수
   */
  function updateViewInfo(angles) {
    if ((!viewInfoEl && !phaseInfoEl) || !angles) return;

    const now = performance.now();
    if (now - state.lastViewInfoAt < 250) return;
    state.lastViewInfoAt = now;

    const view = angles.view || "UNKNOWN";
    const source = angles.angleSource || "UNKNOWN";
    const quality = angles.quality?.level || "UNKNOWN";
    const phase =
      repCounter?.currentPhase || window.REP_PHASES?.NEUTRAL || "UNKNOWN";
    const selectedView = state.selectedView || "N/A";
    const phaseText = `PHASE: ${phase}`;
    const viewText = `VIEW: ${view} / SELECTED: ${selectedView} / SRC: ${source} / Q: ${quality}`;

    if (phaseText !== state.lastViewInfoText) {
      state.lastViewInfoText = phaseText;
      if (phaseInfoEl) {
        phaseInfoEl.textContent = phaseText;
      }
    }

    if (viewInfoEl && viewInfoEl.textContent !== viewText) {
      viewInfoEl.textContent = viewText;
    }
  }

  /**
   * rep 완료 콜백 — RepCounter가 1회 동작 완료 시 호출
   * 1. 카운터 UI 업데이트
   * 2. 메트릭 요약 집계
   * 3. SessionBuffer에 rep + 이벤트 기록
   * 4. 루틴 모드면 checkRoutineProgress()로 다음 단계 전환 판단
   * 5. 피드백 표시
   */
  function handleRepComplete(repRecord) {
    state.currentRep = repRecord.repNumber;
    updatePrimaryCounterDisplay();

    state.lastRepMetricSummary =
      Array.isArray(repRecord.breakdown) && repRecord.breakdown.length > 0
        ? repRecord.breakdown.map((item) => ({
            ...item,
            normalizedScore: getNormalizedMetricScore(item),
          }))
        : Object.values(state.repMetricBuffer || {})
            .map((m) => ({
              metric_id: m.metric_id,
              key: m.key,
              title: m.title,
              maxScore: m.maxScore,
              score: aggregateScores(m.scores),
            }))
            .sort(
              (a, b) =>
                b.score / (b.maxScore || 1) - a.score / (a.maxScore || 1),
            );

    if (sessionBuffer) {
      sessionBuffer.addRep(repRecord);

      sessionBuffer.addEvent("REP_COMPLETE", {
        repNumber: repRecord.repNumber,
        score: repRecord.score,
        duration: repRecord.duration,
        phase: repRecord.phase || null,
        view: repRecord.view || null,
        selected_view: state.selectedView,
        confidence: repRecord.confidence?.level || null,
        feedback: repRecord.feedback || null,
      });
    }

    if (workoutData.mode === "ROUTINE" && workoutData.routine) {
      void checkRoutineProgress();
    }

    showRepFeedback(repRecord);
  }

  /**
   * 점수 UI 업데이트
   * - 시간 기반: 실시간 scoreResult.score 표시
   * - 횟수 기반: 현재 진행 중인 rep의 점수 (RepCounter.getCurrentRepScore)
   * - gated: 품질 게이트 보류 중이면 0점 + 안내 메시지
   * - breakdown: 메트릭별 점수를 scoreBreakdownEl에 표시
   */
  function updateScoreDisplay(scoreResult) {
    const isTimeBased = repCounter?.pattern?.isTimeBased;
    const hasAnyRep = repCounter?.getCount ? repCounter.getCount() > 0 : false;
    const isRepInProgress = repCounter?.isInProgress
      ? repCounter.isInProgress()
      : false;

    const displayScore = isTimeBased
      ? scoreResult.score
      : (hasAnyRep || isRepInProgress) && repCounter?.getCurrentRepScore
        ? repCounter.getCurrentRepScore()
        : 0;

    state.liveScore = displayScore;
    liveScoreEl.textContent =
      !isTimeBased && !hasAnyRep && !isRepInProgress ? "--" : displayScore;

    liveScoreEl.style.background = "none";
    liveScoreEl.style.webkitBackgroundClip = "unset";
    liveScoreEl.style.webkitTextFillColor = "unset";

    if (displayScore >= 80) {
      liveScoreEl.style.color = "#22c55e";
    } else if (displayScore >= 60) {
      liveScoreEl.style.color = "#eab308";
    } else if (displayScore > 0) {
      liveScoreEl.style.color = "#ef4444";
    } else {
      liveScoreEl.style.color = "#94a3b8";
    }

    const shouldShowBreakdown = isTimeBased
      ? scoreResult.breakdown && scoreResult.breakdown.length > 0
      : (isRepInProgress &&
          Object.keys(state.repMetricBuffer || {}).length > 0) ||
        (!isRepInProgress &&
          hasAnyRep &&
          state.lastRepMetricSummary?.length > 0);

    if (shouldShowBreakdown) {
      const items = isTimeBased
        ? scoreResult.breakdown
        : isRepInProgress
          ? Object.values(state.repMetricBuffer).map((m) => ({
              key: m.key,
              title: m.title,
              score: aggregateScores(m.scores),
              maxScore: m.maxScore,
            }))
          : state.lastRepMetricSummary;

      scoreBreakdownEl.innerHTML = items
        .map((item) => ({
          ...item,
          displayScore: getNormalizedMetricScore(item),
          displayMaxScore: 100,
        }))
        .filter((it) => it && it.displayMaxScore != null)
        .sort(
          (a, b) => b.displayScore - a.displayScore,
        )
        .slice(0, 3)
        .map(
          (item) => `
          <div class="score-item">
            <span>${item.title || item.key}</span>
            <span>${Math.round(item.displayScore)}</span>
          </div>
        `,
        )
        .join("");
    } else if (scoreResult.gated && scoreResult.message) {
      scoreBreakdownEl.innerHTML = `<div class="score-item"><span class="muted">${scoreResult.message}</span></div>`;
    } else if (scoreResult.score === 0) {
      scoreBreakdownEl.innerHTML =
        '<div class="score-item"><span class="muted">포즈 감지 중...</span></div>';
    } else if (!isTimeBased && !isRepInProgress) {
      scoreBreakdownEl.innerHTML =
        '<div class="score-item"><span class="muted">rep 시작하면 표시됩니다</span></div>';
    }
  }

  /**
   * 점수 기반 피드백 경고 표시 — 주요 메트릭 점수가 낮으면 알림
   * - selectAlertFeedbackItem(): 가장 점수가 낮은 메트릭 선택
   * - alertCooldown: 3초 쿨다운으로 과도한 알림 방지
   */
  function checkFeedback(scoreResult) {
    if (state.alertCooldown) return;

    const lowScoreItem = selectAlertFeedbackItem(scoreResult);

    if (lowScoreItem) {
      showAlert("자세 교정 필요", lowScoreItem.feedback);

      if (sessionBuffer) {
        sessionBuffer.addEvent("LOW_SCORE_HINT", {
          metric_key: lowScoreItem.key,
          score: lowScoreItem.score,
          maxScore: lowScoreItem.maxScore,
          feedback: lowScoreItem.feedback,
        });
      }
    }
  }

  /**
   * 가장 점수가 낮은 메트릭을 선택해 피드백 메시지 결정
   * - normalizedScore가 70 미만인 메트릭 중 최하위 선택
   * - breakdown의 feedback 필드가 있으면 사용, 없으면 기본 메시지
   */
  function selectAlertFeedbackItem(scoreResult) {
    if (!scoreResult?.breakdown?.length) {
      return null;
    }

    const isTimeBased = Boolean(repCounter?.pattern?.isTimeBased);
    const candidates = scoreResult.breakdown
      .filter((item) => item?.feedback)
      .map((item) => {
        const bufferedScores = !isTimeBased
          ? state.repMetricBuffer?.[item.key]?.scores
          : null;
        const bufferedCount = Array.isArray(bufferedScores) ? bufferedScores.length : 0;
        const normalizedScore = bufferedCount > 0
          ? aggregateScores(bufferedScores)
          : getNormalizedMetricScore(item);
        const requiredSamples = item.key === "heel_contact" ? 4 : 2;
        return {
          ...item,
          score: normalizedScore,
          maxScore: 100,
          normalizedScore,
          bufferedCount,
          requiredSamples,
        };
      })
      .filter((item) => {
        if (item.normalizedScore >= 60) return false;
        if (isTimeBased) return true;
        return item.bufferedCount >= item.requiredSamples;
      })
      .sort((a, b) => a.normalizedScore - b.normalizedScore);

    return candidates[0] || null;
  }

  /**
   * rep 완료 시 짧은 피드백 토스트 표시
   * - repRecord.score에 따라 "좋아요!" / "조금 더!" 등 메시지 분기
   * - repRecord.feedback이 있으면 우선 사용
   */
  function showRepFeedback(repRecord) {
    const msg =
      repRecord.feedback ||
      (repRecord.score >= 80
        ? "완벽해요! 👏"
        : repRecord.score >= 60
          ? "좋아요! 👍"
          : "계속 해보세요!");

    showToast(`${repRecord.repNumber}회 ${msg}`);
  }

  /** 화면 하단 짧은 토스트 메시지 — 2초 후 자동 사라짐 */
  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast workout-session-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  /**
   * 루틴 단계 전환 시 UI 상태 초기화
   * - 카운터, 점수, phase, 세트 정보 리셋
   * - RepCounter/SessionBuffer 새로 생성
   * - ScoringEngine 재바인딩
   */
  function resetStepUiState() {
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
    setCountEl.textContent = 1;
    updatePrimaryCounterDisplay();
    liveScoreEl.textContent = "--";
    scoreBreakdownEl.innerHTML =
      '<div class="score-item"><span class="muted">rep 시작하면 표시됩니다.</span></div>';
    if (repCounter) {
      repCounter.reset();
      if (repCounter.setTargetSec) {
        repCounter.setTargetSec(getCurrentTargetSec());
      }
    }
    updatePlankRuntimeDisplay(
      repCounter?.getTimeSummary ? repCounter.getTimeSummary() : null,
    );
  }

  /**
   * 현재 세트 추적 데이터 초기화 — 세트 전환 시 세트 내 누적 데이터 리셋
   * - state.currentSetWorkSec: 세트 작업 시간
   * - RepCounter: rep 추적 상태 리셋
   * - SessionBuffer: 세트 완료 이벤트 기록
   */
  function resetCurrentSetTracking() {
    state.currentRep = 0;
    state.currentSetWorkSec = 0;
    state.currentSegmentSec = 0;
    state.bestHoldSec = 0;
    state.plankGoalReached = false;
    state.repMetricBuffer = {};
    state.lastRepMetricSummary = [];
    state.repInProgressPrev = false;

    if (repCounter) {
      repCounter.reset();
      if (repCounter.setTargetSec) {
        repCounter.setTargetSec(getCurrentTargetSec());
      }
    }

    updatePrimaryCounterDisplay();
    updatePlankRuntimeDisplay(
      repCounter?.getTimeSummary ? repCounter.getTimeSummary() : null,
    );
  }

  /**
   * 루틴 다음 단계로 전환
   * 1. 현재 운동 코드를 다음 단계 운동으로 변경
   * 2. bindEnginesToCurrentExercise(): ScoringEngine/RepCounter 재초기화
   * 3. resetSessionBufferForSession(): SessionBuffer 재생성
   * 4. resetStepUiState(): UI 상태 초기화
   * 5. syncPlankTargetUi(): 플랭크 목표 시간 UI 동기화
   */
  function switchRoutineStep(stepIndex) {
    const step = workoutData.routine?.routine_setup?.[stepIndex];
    const nextExercise = step?.exercise;

    if (!nextExercise) {
      return false;
    }

    workoutData.exercise = nextExercise;
    workoutData.scoringProfile = step?.scoring_profile || null;
    state.selectedView = resolveDefaultView(nextExercise);
    state.currentTargetSec =
      normalizeRoutineTargetType(step?.target_type) === "TIME"
        ? Math.max(1, Number(step?.target_value) || 1)
        : 0;

    if (!bindEnginesToCurrentExercise()) {
      return false;
    }

    syncPlankTargetUi();

    resetStepUiState();

    if (sessionBuffer) {
      sessionBuffer.addEvent("ROUTINE_STEP_CHANGE", {
        stepIndex,
        exercise_id: nextExercise.exercise_id,
        exercise_code: nextExercise.code,
        selected_view: state.selectedView,
      });
    }

    refreshRoutineCounterUi();
    return true;
  }

  /**
   * 루틴 세트 완료를 서버에 기록 — POST /api/workout/session/:id/set
   * 서버 응답에 action(NEXT_SET/NEXT_STEP/ROUTINE_COMPLETE) + restSec 포함
   * 이 함수는 루틴 진행 상태의 핵심 동기화 지점임
   */
  async function recordRoutineSetCompletion({
    actualValue,
    targetType,
    durationSec,
    score,
    sessionPayload = null,
  }) {
    if (!state.sessionId) {
      throw new Error("sessionId가 없어 루틴 세트를 저장할 수 없습니다.");
    }

    const payload =
      sessionPayload && typeof sessionPayload === "object"
        ? { ...sessionPayload }
        : {};

    payload.actual_value = Math.max(0, Math.round(Number(actualValue) || 0));
    payload.duration_sec = Math.max(0, Math.round(Number(durationSec) || 0));
    payload.score = Number.isFinite(Number(score))
      ? Math.round(Number(score))
      : null;

    if (targetType === "REPS") {
      payload.actual_reps = payload.actual_value;
    }

    const response = await fetch(`/api/workout/session/${state.sessionId}/set`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data?.success) {
      throw new Error(
        data?.error || data?.message || "루틴 세트 저장에 실패했습니다.",
      );
    }

    return data?.routine || null;
  }

  /**
   * 루틴 진행 상태 확인 및 다음 단계 처리
   * trigger: 'REP' | 'HOLD' | 'TIME' — 어떤 이벤트로 인한 체크인지 구분
   * 서버 응답의 action(NEXT_SET/NEXT_STEP/ROUTINE_COMPLETE)에 따라 분기
   *
   * NEXT_SET: 현재 단계의 다음 세트로 → 휴식 후 state.currentSet++
   * NEXT_STEP: 다음 운동 단계로 → switchRoutineStep() → 엔진 재바인딩
   * ROUTINE_COMPLETE: 루틴 전체 완료 → finishWorkout()
   *
   * 서버 응답에 action이 없으면 클라이언트 측 폴백 로직 사용
   */
  async function checkRoutineProgress(trigger = "REP") {
    if (state.phase !== "WORKING") return;
    if (state.routineSetSyncPending) return;

    const currentStep =
      workoutData.routine.routine_setup[state.currentStepIndex];
    if (!currentStep) return;

    const targetType = normalizeRoutineTargetType(currentStep.target_type);
    const targetValue = Math.max(1, Number(currentStep.target_value) || 1);
    const actualValue =
      targetType === "TIME"
        ? isTimeBasedExercise()
          ? state.bestHoldSec
          : state.currentSetWorkSec
        : state.currentRep;

    if (actualValue < targetValue) return;

    state.routineSetSyncPending = true;
    const fallbackRestSec = Math.max(0, Number(currentStep.rest_sec) || 0);

    try {
      let sessionPayload = null;
      const isTimeBased = isTimeBasedExercise();
      const timeSummary =
        isTimeBased && repCounter?.getTimeSummary
          ? repCounter.getTimeSummary()
          : null;

      if (sessionBuffer) {
        if (trigger) {
          sessionBuffer.addEvent("ROUTINE_TARGET_REACHED");
        }
        sessionPayload = sessionBuffer.export({
          isTimeBased,
          targetSec: getCurrentTargetSec(),
          bestHoldSec: timeSummary?.bestHoldSec || state.bestHoldSec || 0,
          bestHoldPostureScore: repCounter?.getBestHoldPostureScore
            ? repCounter.getBestHoldPostureScore()
            : 0,
        });
      } else {
        sessionPayload = {
          selected_view: state.selectedView,
          result_basis: isTimeBased ? "DURATION" : "REPS",
          total_result_value: isTimeBased
            ? timeSummary?.bestHoldSec || state.bestHoldSec || 0
            : actualValue,
          total_result_unit: isTimeBased ? "SEC" : "COUNT",
          duration_sec: state.currentSetWorkSec,
          total_reps: isTimeBased ? 0 : actualValue,
          target_sec: isTimeBased ? getCurrentTargetSec() || null : null,
          best_hold_sec: isTimeBased
            ? timeSummary?.bestHoldSec || state.bestHoldSec || 0
            : null,
          final_score: state.liveScore || 0,
        };
      }

      const routineState = await recordRoutineSetCompletion({
        actualValue,
        targetType,
        durationSec: state.currentSetWorkSec,
        score: state.liveScore,
        sessionPayload,
      });

      const action = String(routineState?.action || "").toUpperCase();
      const restSec = Math.max(
        0,
        Number(
          routineState?.rest_sec != null
            ? routineState.rest_sec
            : fallbackRestSec,
        ) || 0,
      );

      if (action === "ALREADY_PROCESSED") {
        return;
      }

      if (action === "NEXT_SET" || action === "NEXT_STEP") {
        const nextSessionId = Number(routineState?.next_session?.session_id);
        if (!Number.isFinite(nextSessionId) || nextSessionId <= 0) {
          throw new Error("다음 루틴 세션 정보를 받지 못했습니다.");
        }

        const nextTargetType =
          action === "NEXT_STEP"
            ? normalizeRoutineTargetType(routineState?.next_step?.target_type)
            : targetType;
        const nextTargetSec =
          nextTargetType === "TIME"
            ? Math.max(
                1,
                Number(
                  action === "NEXT_STEP"
                    ? routineState?.next_step?.target_value
                    : currentStep.target_value,
                ) || 1,
              )
            : null;
        const nextExerciseCode =
          action === "NEXT_STEP"
            ? routineState?.next_exercise?.code ||
              workoutData.routine?.routine_setup?.[state.currentStepIndex + 1]
                ?.exercise?.code ||
              workoutData.exercise?.code
            : workoutData.exercise?.code;

        resetSessionBufferForSession(nextSessionId, {
          exerciseCode: nextExerciseCode,
          selectedView: routineState?.next_session?.selected_view,
          targetSec: nextTargetSec,
          source: `ROUTINE_${action}`,
        });
      }

      state.currentSetWorkSec = 0;
      updatePrimaryCounterDisplay();

      if (action === "NEXT_SET") {
        if (restSec > 0) {
          startRest(restSec, "NEXT_SET");
        } else {
          state.currentSet++;
          setCountEl.textContent = state.currentSet;
          resetCurrentSetTracking();
          showAlert("다음 세트", `${state.currentSet}세트 시작!`);
        }
        return;
      }

      if (action === "NEXT_STEP") {
        if (restSec > 0) {
          startRest(restSec, "NEXT_EXERCISE");
        } else {
          nextExercise();
        }
        return;
      }

      if (action === "ROUTINE_COMPLETE") {
        nextExercise();
        return;
      }

      // 서버 응답에 루틴 액션이 없으면 기존 클라이언트 흐름으로 폴백
      const hasNextExerciseStep =
        state.currentStepIndex < workoutData.routine.routine_setup.length - 1;

      if (state.currentSet < currentStep.sets) {
        if (restSec > 0) {
          startRest(restSec, "NEXT_SET");
        } else {
          state.currentSet++;
          setCountEl.textContent = state.currentSet;
          resetCurrentSetTracking();
          showAlert("다음 세트", `${state.currentSet}세트 시작!`);
        }
      } else if (hasNextExerciseStep) {
        if (restSec > 0) {
          startRest(restSec, "NEXT_EXERCISE");
        } else {
          nextExercise();
        }
      } else {
        nextExercise();
      }
    } catch (error) {
      console.error("[Session] 루틴 세트 동기화 실패:", error);
      showAlert(
        "루틴 저장 실패",
        "세트 저장에 실패했습니다. 잠시 후 다시 시도됩니다.",
      );
    } finally {
      state.routineSetSyncPending = false;
    }
  }

  /** 운동 시간 타이머 시작 — 1초 간격으로 state.totalTime 증가 + UI 갱신 */
  function startTimer() {
    state.timerInterval = setInterval(() => {
      if (!state.isPaused && state.phase === "WORKING") {
        state.totalTime++;
        if (!isTimeBasedExercise()) {
          state.currentSetWorkSec++;
        }
        updateTimerDisplay();

        if (isRoutineTimeTarget() && !isTimeBasedExercise()) {
          updatePrimaryCounterDisplay();
        }

        if (workoutData.mode === "ROUTINE" && workoutData.routine) {
          void checkRoutineProgress("TIMER");
        }
      }
    }, 1000);
  }

  /** 타이머 UI 갱신 — 경과 시간을 MM:SS로 표시 */
  function updateTimerDisplay() {
    const mins = Math.floor(state.totalTime / 60);
    const secs = state.totalTime % 60;
    timerValueEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  /** 상태 뱃지 UI 업데이트 (PREPARING/WORKING/PAUSED/FINISHED 등) */
  function updateStatus(className, text) {
    statusBadge.className = "status " + className;
    statusBadge.textContent = text;
  }

  /** 일시정지/재개 토글 — 타이머/프레임 루프 정지 & Wake Lock 해제/재획득 */
  function togglePause() {
    state.isPaused = !state.isPaused;

    if (state.isPaused) {
      state.phase = "PAUSED";
      updateStatus("paused", "일시정지");
      pauseBtn.innerHTML = "계속하기";
      if (poseEngine) poseEngine.stop();
      if (sessionBuffer) sessionBuffer.addEvent("PAUSE");
      releaseWakeLock();
    } else {
      state.phase = "WORKING";
      updateStatus("running", "운동 중");
      pauseBtn.innerHTML = "일시정지";
      if (poseEngine) poseEngine.start();
      if (sessionBuffer) sessionBuffer.addEvent("RESUME");
      requestWakeLock();
    }
  }

  /** 루틴 세트 간 휴식 타이머 시작 — afterAction: 'NEXT_SET' | 'NEXT_STEP' | 'ROUTINE_COMPLETE' */
  function startRest(seconds, afterAction = "NEXT_SET") {
    state.phase = "RESTING";
    state.restTimeLeft = seconds;
    state.restAfterAction = afterAction;
    updateStatus("rest", "휴식 중");
    timerLabelEl.textContent = "휴식 시간";
    restTimerEl.hidden = false;
    restValueEl.textContent = seconds;

    if (poseEngine) poseEngine.stop();
    if (sessionBuffer)
      sessionBuffer.addEvent("REST_START", { duration: seconds });

    state.restInterval = setInterval(() => {
      if (!state.isPaused) {
        state.restTimeLeft--;
        restValueEl.textContent = state.restTimeLeft;

        if (state.restTimeLeft <= 0) {
          endRest();
        }
      }
    }, 1000);
  }

  /** 휴식 종료 — 타이머 정리 후 afterAction에 따라 다음 세트/단계/완료 분기 */
  function endRest() {
    clearInterval(state.restInterval);
    restTimerEl.hidden = true;
    state.phase = "WORKING";
    timerLabelEl.textContent = "운동 시간";
    updateStatus("running", "운동 중");
    syncPlankTargetUi();

    const action = state.restAfterAction || "NEXT_SET";
    state.restAfterAction = null;

    if (action === "NEXT_EXERCISE") {
      if (poseEngine) poseEngine.start();
      if (sessionBuffer) sessionBuffer.addEvent("REST_END");
      nextExercise();
      return;
    }

    state.currentSet++;
    setCountEl.textContent = state.currentSet;
    resetCurrentSetTracking();

    if (poseEngine) poseEngine.start();
    if (sessionBuffer) sessionBuffer.addEvent("REST_END");

    showAlert("다음 세트", `${state.currentSet}세트 시작!`);
  }

  /** 품질 게이트/에러 알림 배너 표시 */
  function showAlert(title, message) {
    if (state.alertCooldown) return;

    alertTitle.textContent = title;
    alertMessage.textContent = message;
    alertContainer.hidden = false;

    state.alertCooldown = true;
    setTimeout(() => {
      alertContainer.hidden = true;
      state.alertCooldown = false;
    }, 3000);
  }

  /** 루틴 다음 운동으로 전환 (버튼/자동) — switchRoutineStep 래퍼 */
  function nextExercise() {
    state.restAfterAction = null;
    state.currentStepIndex++;
    const routineSteps = workoutData.routine.routine_setup;

    if (state.currentStepIndex >= routineSteps.length) {
      finishWorkout();
      return;
    }

    const switched = switchRoutineStep(state.currentStepIndex);
    if (!switched) {
      showAlert("루틴 오류", "다음 운동의 채점 설정을 불러오지 못했습니다.");
      finishWorkout();
      return;
    }

    const progress = (state.currentStepIndex / routineSteps.length) * 100;
    document.getElementById("routineProgress").style.width = `${progress}%`;
    document.getElementById("routineStep").textContent =
      `${state.currentStepIndex + 1} / ${routineSteps.length} 운동`;

    state.currentSet = 1;
    state.currentRep = 0;
    state.currentSetWorkSec = 0;
    setCountEl.textContent = 1;
    updatePrimaryCounterDisplay();
    updateRoutineStepDisplay();

    if (repCounter) repCounter.reset();
    if (sessionBuffer) {
      sessionBuffer.addEvent("NEXT_EXERCISE", {
        stepIndex: state.currentStepIndex,
        exercise_code: workoutData.exercise?.code || null,
      });
    }

    showAlert(
      "다음 운동",
      routineSteps[state.currentStepIndex].exercise?.name || "다음 운동",
    );
  }

  /**
   * 운동 세션 종료 — 핵심 종료 로직
   * 1. phase → FINISHED, 타이머/프레임 루프 정지, Wake Lock 해제
   * 2. SessionBuffer.export()로 최종 페이로드 생성
   * 3. PUT /api/workout/session/:id/end 로 서버에 저장
   * 4. 결과 페이지로 리다이렉트
   */
  async function finishWorkout() {
    if (!state.sessionId || isEndingSession) return;
    isEndingSession = true;
    finishBtn.disabled = true;
    finishBtn.textContent = "저장 중...";
    pauseBtn.disabled = true;

    state.phase = "FINISHED";
    clearInterval(state.timerInterval);
    clearInterval(state.restInterval);
    if (state.frameLoop) {
      cancelAnimationFrame(state.frameLoop);
    }
    if (poseEngine) {
      poseEngine.stop();
    }
    sessionCamera.destroy();
    releaseWakeLock();

    updateStatus("finished", "완료");

    try {
      const isTimeBased = isTimeBasedExercise();
      const timeSummary =
        isTimeBased && repCounter?.getTimeSummary
          ? repCounter.getTimeSummary()
          : null;
      const sessionData =
        pendingSessionPayload ||
        (sessionBuffer
          ? sessionBuffer.export({
              isTimeBased,
              targetSec: getCurrentTargetSec(),
              bestHoldSec: timeSummary?.bestHoldSec || state.bestHoldSec || 0,
              bestHoldPostureScore: repCounter?.getBestHoldPostureScore
                ? repCounter.getBestHoldPostureScore()
                : 0,
            })
          : {
              selected_view: state.selectedView,
              result_basis: isTimeBased ? "DURATION" : "REPS",
              total_result_value: isTimeBased
                ? timeSummary?.bestHoldSec || state.bestHoldSec || 0
                : state.currentRep,
              total_result_unit: isTimeBased ? "SEC" : "COUNT",
              duration_sec: state.totalTime,
              total_reps: isTimeBased ? 0 : state.currentRep,
              target_sec: getCurrentTargetSec() || null,
              best_hold_sec: timeSummary?.bestHoldSec || state.bestHoldSec || 0,
              final_score: state.liveScore || 0,
              summary_feedback: generateSummary(isTimeBased, timeSummary),
            });
      pendingSessionPayload = sessionData;

      const response = await fetch(
        `/api/workout/session/${state.sessionId}/end`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sessionData),
        },
      );

      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          responseBody.error || responseBody.message || "세션 종료 실패",
        );
      }

      if (sessionBuffer) {
        sessionBuffer.clearStorage();
      }
      pendingSessionPayload = null;
      window.location.href = `/workout/result/${state.sessionId}`;
    } catch (error) {
      console.error("[Session] 종료 에러:", error);
      showAlert(
        "저장 실패",
        "운동 결과 저장에 실패했습니다. 종료 버튼을 다시 눌러 재시도해 주세요.",
      );
      finishBtn.disabled = false;
      finishBtn.textContent = "저장 재시도";
    } finally {
      isEndingSession = false;
    }
  }

  /** 세션 종료 시 요약 피드백 텍스트 생성 — 시간 기반/횟수 기반 분기 */
  function generateSummary(
    isTimeBased = isTimeBasedExercise(),
    timeSummary = null,
  ) {
    if (isTimeBased) {
      const bestHoldSec = timeSummary?.bestHoldSec || state.bestHoldSec || 0;
      const targetSec = getCurrentTargetSec();
      if (bestHoldSec >= targetSec && targetSec > 0) {
        return `목표 ${targetSec}초를 달성했습니다. 최고 ${bestHoldSec}초를 유지했어요.`;
      }
      if (bestHoldSec > 0 && targetSec > 0) {
        return `최고 ${bestHoldSec}초 유지했습니다. 목표 ${targetSec}초까지 조금 더 도전해보세요.`;
      }
      return "플랭크 자세를 안정적으로 유지해보세요.";
    }

    if (state.liveScore >= 80) {
      return "훌륭해요! 자세가 매우 좋습니다.";
    }
    if (state.liveScore >= 60) {
      return "좋아요! 조금만 더 신경쓰면 완벽해요.";
    }
    return "자세 교정이 필요합니다. 운동 배우기를 확인해보세요.";
  }

  /** 종료 확인 모달 표시 */
  function confirmExit() {
    if (state.phase === "PREPARING") {
      window.location.href =
        workoutData.mode === "ROUTINE" ? "/routine" : "/workout/free";
    } else {
      document.getElementById("exitModal").hidden = false;
    }
  }

  /** 종료 확인 모달 닫기 */
  function closeExitModal() {
    document.getElementById("exitModal").hidden = true;
  }

  /** 강제 종료 — 확인 없이 페이지 이탈 */
  function forceExit() {
    finishWorkout();
  }

  /**
   * 페이지 이탈/강제 종료 시 beacon으로 서버에 ABORTED 알림
   * navigator.sendBeacon() 사용해 페이지 언로드 중에도 전송 보장
   */
  function sendAbortBeacon(reason = "UNLOAD") {
    if (!state.sessionId || hasUnloadAbortSent || state.phase === "FINISHED") {
      return;
    }

    hasUnloadAbortSent = true;
    const payload = JSON.stringify({
      reason,
      selected_view: state.selectedView,
      duration_sec: state.totalTime || 0,
      total_reps: isTimeBasedExercise() ? 0 : state.currentRep || 0,
      total_result_value: isTimeBasedExercise()
        ? state.bestHoldSec || 0
        : state.currentRep || 0,
      result_basis: isTimeBasedExercise() ? "DURATION" : "REPS",
      target_sec: isTimeBasedExercise() ? getCurrentTargetSec() || null : null,
    });
    const url = `/api/workout/session/${state.sessionId}/abort`;

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: "application/json" });
      navigator.sendBeacon(url, blob);
      return;
    }

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }

  // ── 페이지 이탈 처리: 세션 버퍼 localStorage 백업 + ABORTED beacon 전송 ──
  window.addEventListener("beforeunload", () => {
    if (
      state.phase === "WORKING" ||
      state.phase === "RESTING" ||
      state.phase === "PAUSED"
    ) {
      if (sessionBuffer) sessionBuffer.saveToStorage();
      sendAbortBeacon("UNLOAD");
    }
  });

  // ── 전역 노출: EJS 템플릿에서 onclick="startWorkout()" 등으로 호출 ──
  window.confirmExit = confirmExit;
  window.startWorkout = startWorkout;
  window.togglePause = togglePause;
  window.finishWorkout = finishWorkout;
  window.closeExitModal = closeExitModal;
  window.forceExit = forceExit;

  // ── 초기화: UI 바인딩 → 카메라 연결 → 세션 준비 완료 ──
  setupSourceSelectors();
  setupViewSelectors();
  setupPlankTargetControls();
  applyPreviewOrientation(selectedCameraSource);
  if (isPlankExerciseCode()) {
    if (workoutData.mode === "ROUTINE") {
      applyTargetSec(getCurrentTargetSec() || 0);
    } else {
      applyTargetSec(readTargetSecFromInput() || 30);
    }
  } else {
    syncPlankTargetUi();
  }
  refreshRoutineCounterUi();
  await connectCameraSource(selectedCameraSource);
}

/**
 * Map a quality-gate withhold reason code to a user-facing corrective message.
 * Spec §8: withhold → corrective guidance, never low-score accumulation.
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
 * Determine whether scoring can resume after a withhold period.
 * Spec §7.2 Rule 5: gate returns to pass only after stable-frame streak threshold is met.
 */
function shouldResumeScoring({ stableFrameCount, threshold }) {
  return stableFrameCount >= threshold;
}

/** 프레임 안정성 확인 — 품질 레벨이 LOW가 아니고 뷰 안정성 ≥ 0.5면 안정으로 판단 */
function isFrameStable(poseData) {
  const quality = poseData?.angles?.quality;
  if (!quality) return false;
  return quality.level !== 'LOW' && quality.viewStability >= 0.5;
}

/** 모바일 전면 카메라 프리뷰 미러링 여부 */
function shouldMirrorSourcePreview(sourceType) {
  return sourceType === 'mobile_front';
}

/** 품질 게이트 추적기 초기화 — 안정 프레임 수와 withold 상태 관리 */
function createQualityGateTracker() {
  return {
    stableFrameCount: 0,
    recentStabilityWindow: [],
    isWithholding: false,
    withholdReason: null,
  };
}

/**
 * 품질 게이트 추적기 업데이트 — 매 프레임마다 호출
 * 최근 12프레임의 안정성 비율 계산, 연속 안정 프레임 수 갱신
 */
function updateQualityGateTracker(poseData, tracker) {
  const stable = isFrameStable(poseData);
  tracker.recentStabilityWindow.push(stable);
  const windowSize = 12;
  if (tracker.recentStabilityWindow.length > windowSize) {
    tracker.recentStabilityWindow.shift();
  }
  tracker.stableFrameCount = stable ? tracker.stableFrameCount + 1 : 0;

  const unstableCount = tracker.recentStabilityWindow.filter(s => !s).length;
  const unstableRatio = tracker.recentStabilityWindow.length > 0
    ? unstableCount / tracker.recentStabilityWindow.length
    : 0;

  return {
    stableFrameCount: tracker.stableFrameCount,
    unstableFrameRatio: unstableRatio,
  };
}

/**
 * PoseEngine의 품질 데이터에서 품질 게이트 입력 객체 생성
 * ScoringEngine.evaluateQualityGate()에 전달할 표준 형식으로 변환
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

  // pose-engine의 표준 빌더가 있으면 사용, 테스트 환경에서는 rawInputs 그대로 반환
  if (typeof buildQualityGateInputs === 'function') {
    return buildQualityGateInputs(rawInputs);
  }
  return rawInputs;
}

/**
 * 채점 억제 결정 — 게이트 withold 또는 안정 프레임 부족 시 true 반환
 * tracker.isWithholding 상태는 연속 안정 프레임이 threshold에 도달해야 해제됨
 */
function shouldSuppressScoring(gateResult, tracker, threshold) {
  if (gateResult.result === 'withhold') {
    tracker.isWithholding = true;
    tracker.withholdReason = gateResult.reason;
    return { suppress: true, reason: gateResult.reason };
  }

  if (tracker.isWithholding && !shouldResumeScoring({
    stableFrameCount: tracker.stableFrameCount,
    threshold,
  })) {
    return { suppress: true, reason: tracker.withholdReason || 'insufficient_stable_frames' };
  }

  tracker.isWithholding = false;
  tracker.withholdReason = null;
  return { suppress: false, reason: null };
}

if (typeof window !== 'undefined') {
  window.initSession = initSession;
  window.mapWithholdReasonToMessage = mapWithholdReasonToMessage;
  window.shouldResumeScoring = shouldResumeScoring;
  window.createQualityGateTracker = createQualityGateTracker;
  window.updateQualityGateTracker = updateQualityGateTracker;
  window.buildGateInputsFromPoseData = buildGateInputsFromPoseData;
  window.shouldSuppressScoring = shouldSuppressScoring;
  window.isFrameStable = isFrameStable;
  window.shouldMirrorSourcePreview = shouldMirrorSourcePreview;
}

// CommonJS test exports
if (typeof module !== 'undefined') {
  module.exports = {
    initSession,
    mapWithholdReasonToMessage,
    shouldResumeScoring,
    createQualityGateTracker,
    updateQualityGateTracker,
    buildGateInputsFromPoseData,
    shouldSuppressScoring,
    isFrameStable,
    shouldMirrorSourcePreview,
  };
}
