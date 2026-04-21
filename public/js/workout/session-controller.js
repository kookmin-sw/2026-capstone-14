/**
 * 운동 세션 페이지 — 포즈/점수/루틴/세션 저장 오케스트레이션
 * @param {object} workoutData 서버에서 주입된 세션 데이터
 */
async function initSession(workoutData) {
  let poseEngine = null;
  let scoringEngine = null;
  let repCounter = null;
  let sessionBuffer = null;
  let exerciseModule = null;

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

  const videoElement = document.getElementById("videoElement");
  const poseCanvas = document.getElementById("poseCanvas");
  const cameraOverlay = document.getElementById("cameraOverlay");
  const statusBadge = document.getElementById("statusBadge");
  const liveScoreEl = document.getElementById("liveScore");
  const scoreModeLabelEl = document.getElementById("scoreModeLabel");
  const scoreBreakdownEl = document.getElementById("scoreBreakdown");
  const phaseInfoEl = document.getElementById("phaseInfo");
  const viewInfoEl = document.getElementById("viewInfo");
  const repCountEl = document.getElementById("repCount");
  const repCountLabelEl = document.getElementById("repCountLabel");
  const setCountEl = document.getElementById("setCount");
  const timerValueEl = document.getElementById("timerValue");
  const timerLabelEl = document.getElementById("timerLabel");
  const restTimerEl = document.getElementById("restTimer");
  const restValueEl = document.getElementById("restValue");
  const alertContainer = document.getElementById("alertContainer");
  const alertTitle = document.getElementById("alertTitle");
  const alertMessage = document.getElementById("alertMessage");
  const startBtn = document.getElementById("startBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const finishBtn = document.getElementById("finishBtn");
  const viewSelectRoot = document.getElementById("viewSelect");
  const routineStepEl = document.getElementById("routineStep");
  const plankTargetSelectRoot = document.getElementById("plankTargetSelect");
  const plankTargetInput = document.getElementById("plankTargetSeconds");
  const plankTargetHint = document.getElementById("plankTargetHint");
  const plankTargetReadoutEl = document.getElementById("plankTargetReadout");
  const plankCurrentHoldEl = document.getElementById("plankCurrentHold");
  const plankBestHoldEl = document.getElementById("plankBestHold");
  const plankPhaseInfoEl = document.getElementById("plankPhaseInfo");
  const plankProgressEl = document.getElementById("plankProgress");
  const plankStateLabelEl = document.getElementById("plankStateLabel");
  const plankGoalLabelEl = document.getElementById("plankGoalLabel");
  const plankSegmentLabelEl = document.getElementById("plankSegmentLabel");

  const normalizeViewCode = (value) => {
    const normalized = (value || "").toString().trim().toUpperCase();
    return ["FRONT", "SIDE", "DIAGONAL"].includes(normalized)
      ? normalized
      : null;
  };

  const isPlankExerciseCode = (exerciseCode = workoutData.exercise?.code) =>
    (exerciseCode || "").toString().trim().toLowerCase().replace(/-/g, "_") ===
    "plank";

  const formatClock = (totalSeconds) => {
    const safe = Math.max(0, Math.round(Number(totalSeconds) || 0));
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const isTimeBasedExercise = () => Boolean(repCounter?.pattern?.isTimeBased);

  const readTargetSecFromInput = () => {
    const parsed = Number(plankTargetInput?.value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(10, Math.round(parsed));
  };

  const getCurrentTargetSec = () => {
    if (workoutData.mode === "ROUTINE" && workoutData.routine) {
      const step = getCurrentRoutineStep();
      if (normalizeRoutineTargetType(step?.target_type) === "TIME") {
        return Math.max(1, Number(step?.target_value) || 1);
      }
    }

    return Math.max(0, Number(state.currentTargetSec) || 0);
  };

  const canStartCurrentExercise = () => {
    if (!isPlankExerciseCode()) return true;
    if (workoutData.mode === "ROUTINE") return getCurrentTargetSec() > 0;
    return getCurrentTargetSec() >= 10;
  };

  function getAllowedViews(exercise = workoutData.exercise) {
    const allowed = Array.isArray(exercise?.allowed_views)
      ? exercise.allowed_views
      : [];
    const normalized = allowed
      .map((code) => normalizeViewCode(code))
      .filter(Boolean);
    return normalized.length > 0 ? normalized : ["FRONT"];
  }

  function resolveDefaultView(exercise = workoutData.exercise) {
    const allowed = getAllowedViews(exercise);
    const defaultView = normalizeViewCode(exercise?.default_view);
    if (defaultView && allowed.includes(defaultView)) return defaultView;
    return allowed[0] || "FRONT";
  }

  function normalizeRoutineTargetType(value) {
    const normalized = (value || "").toString().trim().toUpperCase();
    if (normalized === "DURATION") return "TIME";
    return normalized === "TIME" ? "TIME" : "REPS";
  }

  function getCurrentRoutineStep() {
    return workoutData.routine?.routine_setup?.[state.currentStepIndex] || null;
  }

  function isRoutineTimeTarget() {
    if (workoutData.mode !== "ROUTINE" || !workoutData.routine) return false;
    const step = getCurrentRoutineStep();
    return normalizeRoutineTargetType(step?.target_type) === "TIME";
  }

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

  function updateRoutineStepDisplay() {
    if (
      !routineStepEl ||
      workoutData.mode !== "ROUTINE" ||
      !workoutData.routine
    )
      return;

    const steps = Array.isArray(workoutData.routine.routine_setup)
      ? workoutData.routine.routine_setup
      : [];
    if (steps.length === 0) return;

    const stepIndex = Math.min(state.currentStepIndex, steps.length - 1);
    const step = steps[stepIndex] || {};
    const targetType = normalizeRoutineTargetType(step.target_type);
    const targetValue = Math.max(1, Number(step.target_value) || 1);
    const unit = targetType === "TIME" ? "\uCD08" : "\uD68C";
    const sets = Math.max(1, Number(step.sets) || 1);

    routineStepEl.textContent = `${stepIndex + 1} / ${steps.length} \uC6B4\uB3D9 \u00B7 \uBAA9\uD45C ${targetValue}${unit} \u00D7 ${sets}\uC138\uD2B8`;
  }

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
  let selectedCameraSource = window.SESSION_CAMERA_DEFAULT_SOURCE || "screen";
  const sessionCamera = new SessionCamera(videoElement, poseCanvas);
  let wakeLock = null;

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

  function getCurrentExerciseCode() {
    return ((workoutData.exercise && workoutData.exercise.code) || "")
      .toString()
      .trim()
      .toLowerCase()
      .replace(/-/g, "_");
  }

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

  function getFrameGateResult(angles) {
    if (!exerciseModule?.getFrameGate) {
      return { isReady: true };
    }

    return (
      exerciseModule.getFrameGate(angles, getExerciseRuntime({ angles })) || {
        isReady: true,
      }
    );
  }

  async function initAIEngines() {
    try {
      cameraOverlay.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
          <style>@keyframes spin-anim { 100% { transform: rotate(360deg); } }</style>
          <div style="width:36px; height:36px; border:4px solid rgba(255,255,255,0.2); border-top-color:#fff; border-radius:50%; animation:spin-anim 1s linear infinite;"></div>
          <p style="margin:0; font-weight:500;">AI 모델을 불러오는 중입니다...</p>
          <span class="muted" style="font-size:12px;">최초 1회 실행 시 환경에 따라 시간이 소요될 수 있습니다.</span>
        </div>
      `;

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
      cameraOverlay.innerHTML =
        '<p>AI 엔진 로딩 실패</p><p class="muted">페이지를 새로고침해주세요</p>';
      return false;
    }
  }

  async function connectCameraSource(sourceType) {
    cameraOverlay.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
        <style>@keyframes spin-anim { 100% { transform: rotate(360deg); } }</style>
        <div style="width:36px; height:36px; border:4px solid rgba(255,255,255,0.2); border-top-color:#fff; border-radius:50%; animation:spin-anim 1s linear infinite;"></div>
        <p style="margin:0; font-weight:500;">카메라를 연결 중...</p>
      </div>
    `;
    cameraOverlay.hidden = false;
    startBtn.disabled = true;

    if (!aiEnginesInitialized) {
      const aiReady = await initAIEngines();
      if (!aiReady) return;
      aiEnginesInitialized = true;
    }

    try {
      sessionCamera.destroy();
      const stream = await sessionCamera.getStream(sourceType);
      sessionCamera.applyStream(stream);

      cameraOverlay.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
          <div style="width:36px; height:36px; border:4px solid rgba(255,255,255,0.2); border-top-color:#fff; border-radius:50%; animation:spin-anim 1s linear infinite;"></div>
          <p style="margin:0; font-weight:500;">AI 모델 최적화 중입니다...</p>
          <span class="muted" style="font-size:12px;">운동 시작 시 끊김을 방지하기 위해 웜업(Warm-up)을 진행합니다.</span>
        </div>
      `;

      await new Promise((resolve) => {
        if (videoElement.readyState >= 2) resolve();
        else
          videoElement.addEventListener("loadeddata", resolve, { once: true });
      });

      if (poseEngine && poseEngine.send) {
        await poseEngine.send(videoElement);
      }

      cameraOverlay.innerHTML = cameraReadyHtml;
      startBtn.disabled = !canStartCurrentExercise();
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

  async function startWorkout() {
    const prevOverlayHtml = cameraOverlay.innerHTML;
    const prevOverlayHidden = cameraOverlay.hidden;
    const prevStartHidden = startBtn.hidden;
    const prevStartDisabled = startBtn.disabled;

    cameraOverlay.hidden = true;
    startBtn.hidden = true;
    startBtn.disabled = true;

    if (!state.selectedView) {
      state.selectedView = resolveDefaultView();
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
      alert("운동 시작에 실패했습니다: " + error.message);
    }
  }

  function startPoseDetection() {
    if (!poseEngine) return;

    poseEngine.start();

    const processFrame = async () => {
      if (poseEngine && poseEngine.isRunning && !state.isPaused) {
        await poseEngine.send(videoElement);

        if (poseEngine.lastResults) {
          poseEngine.drawPose(poseCanvas, poseEngine.lastResults);
        }
      }

      if (state.phase !== "FINISHED") {
        state.frameLoop = requestAnimationFrame(processFrame);
      }
    };

    state.frameLoop = requestAnimationFrame(processFrame);
    console.log("[Session] 포즈 감지 시작");
  }

  function handlePoseDetected(poseData) {
    noPersonCount = 0;

    if (state.phase !== "WORKING" || state.isPaused) return;

    const { angles } = poseData;
    updateViewInfo(angles);

    const stabilityMetrics = updateQualityGateTracker(poseData, qualityGateTracker);
    const gateInputs = buildGateInputsFromPoseData(poseData, stabilityMetrics);
    const gateContext = {
      allowedViews: getAllowedViews(),
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

    const frameGate = getFrameGateResult(angles);
    if (!frameGate.isReady) {
      if (isTimeBasedExercise() && repCounter?.handleTimeBreak) {
        repCounter.handleTimeBreak(frameGate.reason || "FRAME_GATE");
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
        message: frameGate.message,
      });
      if (frameGate.message) {
        showAlert("자세 인식 대기", frameGate.message);
      }
      return;
    }

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
    updateViewInfo(angles);

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

  function checkFeedback(scoreResult) {
    if (state.alertCooldown) return;

    const lowScoreItem = scoreResult.breakdown?.find(
      (item) => item.feedback && item.score < item.maxScore * 0.6,
    );

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

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast workout-session-toast";
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

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

  function updateTimerDisplay() {
    const mins = Math.floor(state.totalTime / 60);
    const secs = state.totalTime % 60;
    timerValueEl.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function updateStatus(className, text) {
    statusBadge.className = "status " + className;
    statusBadge.textContent = text;
  }

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

  function confirmExit() {
    if (state.phase === "PREPARING") {
      window.location.href =
        workoutData.mode === "ROUTINE" ? "/routine" : "/workout/free";
    } else {
      document.getElementById("exitModal").hidden = false;
    }
  }

  function closeExitModal() {
    document.getElementById("exitModal").hidden = true;
  }

  function forceExit() {
    finishWorkout();
  }

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

  window.confirmExit = confirmExit;
  window.startWorkout = startWorkout;
  window.togglePause = togglePause;
  window.finishWorkout = finishWorkout;
  window.closeExitModal = closeExitModal;
  window.forceExit = forceExit;

  setupSourceSelectors();
  setupViewSelectors();
  setupPlankTargetControls();
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
    body_not_fully_visible: '몸 전체가 화면에 보이도록 조금 더 뒤로 가 주세요.',
    key_joints_not_visible: '팔과 다리가 잘 보이도록 자세와 카메라를 조정해 주세요.',
    view_mismatch: '현재 운동은 옆면 시점이 필요합니다.',
    unstable_tracking: '카메라를 고정하고 잠시 자세를 유지해 주세요.',
    insufficient_stable_frames: '잠시 정지한 뒤 다시 시작해 주세요.',
    camera_too_close_or_far: '카메라와의 거리를 조금 조정해 주세요.',
    low_detection_confidence: '조명이 충분한지 확인해 주세요.',
    low_tracking_confidence: '몸이 잘 보이도록 위치를 다시 맞춰 주세요.',
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

function isFrameStable(poseData) {
  const quality = poseData?.angles?.quality;
  if (!quality) return false;
  return quality.level !== 'LOW' && quality.viewStability >= 0.5;
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

  const unstableCount = tracker.recentStabilityWindow.filter(s => !s).length;
  const unstableRatio = tracker.recentStabilityWindow.length > 0
    ? unstableCount / tracker.recentStabilityWindow.length
    : 0;

  return {
    stableFrameCount: tracker.stableFrameCount,
    unstableFrameRatio: unstableRatio,
  };
}

function buildGateInputsFromPoseData(poseData, stabilityMetrics) {
  const quality = poseData?.angles?.quality || {};
  const view = poseData?.angles?.view || 'UNKNOWN';

  const rawInputs = {
    frameInclusionRatio: quality.inFrameRatio ?? 1.0,
    keyJointVisibilityAverage: quality.avgVisibility ?? 0,
    minKeyJointVisibility: quality.visibleRatio ?? 0,
    estimatedView: view,
    estimatedViewConfidence: quality.viewStability ?? 0,
    detectionConfidence: quality.avgVisibility ?? 0,
    trackingConfidence: quality.avgVisibility ?? 0,
    stableFrameCount: stabilityMetrics.stableFrameCount,
    unstableFrameRatio: stabilityMetrics.unstableFrameRatio,
    cameraDistanceOk: true,
  };

  // Use the canonical builder from pose-engine when available (browser runtime).
  // Falls back to pass-through for test environments where pose-engine isn't loaded.
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
  };
}
