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
    phase: 'PREPARING',
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
    lastViewInfoText: '',
    repInProgressPrev: false,
    repMetricBuffer: {},
    lastRepMetricSummary: []
  };

  const videoElement = document.getElementById('videoElement');
  const poseCanvas = document.getElementById('poseCanvas');
  const cameraOverlay = document.getElementById('cameraOverlay');
  const statusBadge = document.getElementById('statusBadge');
  const liveScoreEl = document.getElementById('liveScore');
  const scoreBreakdownEl = document.getElementById('scoreBreakdown');
  const phaseInfoEl = document.getElementById('phaseInfo');
  const viewInfoEl = document.getElementById('viewInfo');
  const repCountEl = document.getElementById('repCount');
  const setCountEl = document.getElementById('setCount');
  const timerValueEl = document.getElementById('timerValue');
  const timerLabelEl = document.getElementById('timerLabel');
  const restTimerEl = document.getElementById('restTimer');
  const restValueEl = document.getElementById('restValue');
  const alertContainer = document.getElementById('alertContainer');
  const alertTitle = document.getElementById('alertTitle');
  const alertMessage = document.getElementById('alertMessage');
  const startBtn = document.getElementById('startBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const finishBtn = document.getElementById('finishBtn');
  const viewSelectRoot = document.getElementById('viewSelect');

  const normalizeViewCode = (value) => {
    const normalized = (value || '').toString().trim().toUpperCase();
    return ['FRONT', 'SIDE', 'DIAGONAL'].includes(normalized) ? normalized : null;
  };

  function getAllowedViews(exercise = workoutData.exercise) {
    const allowed = Array.isArray(exercise?.allowed_views) ? exercise.allowed_views : [];
    const normalized = allowed
      .map((code) => normalizeViewCode(code))
      .filter(Boolean);
    return normalized.length > 0 ? normalized : ['FRONT'];
  }

  function resolveDefaultView(exercise = workoutData.exercise) {
    const allowed = getAllowedViews(exercise);
    const defaultView = normalizeViewCode(exercise?.default_view);
    if (defaultView && allowed.includes(defaultView)) return defaultView;
    return allowed[0] || 'FRONT';
  }

  let isEndingSession = false;
  let pendingSessionPayload = null;
  let hasUnloadAbortSent = false;
  let aiEnginesInitialized = false;
  let selectedCameraSource = window.SESSION_CAMERA_DEFAULT_SOURCE || 'screen';
  const sessionCamera = new SessionCamera(videoElement, poseCanvas);

  const cameraReadyHtml = '<p>준비 완료</p><p class="muted">전신이 잘 보이도록 위치를 조정하세요</p>';

  let noPersonCount = 0;
  const NO_PERSON_THRESHOLD = 30;
  state.selectedView = normalizeViewCode(workoutData.selectedView) || resolveDefaultView();

  function getCurrentExerciseCode() {
    return ((workoutData.exercise && workoutData.exercise.code) || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/-/g, '_');
  }

  function bindEnginesToCurrentExercise() {
    if (!workoutData.exercise) {
      return false;
    }

    scoringEngine = new ScoringEngine(workoutData.scoringProfile || null, {
      exerciseCode: workoutData.exercise.code,
      selectedView: state.selectedView
    });
    exerciseModule = window.WorkoutExerciseRegistry?.get(workoutData.exercise.code) || null;

    repCounter = new RepCounter(workoutData.exercise.code);
    repCounter.repEvaluator = (repRecord) => scoringEngine.scoreRep(repRecord);
    repCounter.onRepComplete = handleRepComplete;
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
      ...extra
    };
  }

  function getFrameGateResult(angles) {
    if (!exerciseModule?.getFrameGate) {
      return { isReady: true };
    }

    return exerciseModule.getFrameGate(angles, getExerciseRuntime({ angles })) || { isReady: true };
  }

  async function initAIEngines() {
    try {
      cameraOverlay.innerHTML = '<p>AI 엔진 로딩 중...</p>';

      poseEngine = new PoseEngine();
      await poseEngine.initialize();

      if (!bindEnginesToCurrentExercise()) {
        throw new Error('운동 정보를 불러오지 못했습니다.');
      }

      poseEngine.onPoseDetected = handlePoseDetected;
      poseEngine.onNoPerson = handleNoPerson;

      console.log('[Session] AI 엔진 초기화 완료');
      return true;
    } catch (error) {
      console.error('[Session] AI 엔진 초기화 실패:', error);
      cameraOverlay.innerHTML = '<p>AI 엔진 로딩 실패</p><p class="muted">페이지를 새로고침해주세요</p>';
      return false;
    }
  }

  async function connectCameraSource(sourceType) {
    cameraOverlay.innerHTML = '<p>카메라를 연결 중...</p>';
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
      cameraOverlay.innerHTML = cameraReadyHtml;
      startBtn.disabled = false;
    } catch (error) {
      console.error('[Session] 카메라 에러:', error);

      let userMessage = '권한을 확인하거나 다른 입력 소스를 선택해 주세요';
      if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        userMessage = '카메라가 감지되지 않았습니다. 다른 입력 소스를 선택해 주세요';
      } else if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        userMessage = '카메라 권한이 거부되었습니다. 브라우저 설정에서 허용해 주세요';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        userMessage = '카메라를 열 수 없습니다. 다른 프로그램이 카메라를 사용 중이거나 드라이버 문제일 수 있습니다';
      } else if (error.name === 'AbortError') {
        userMessage = '사용자가 취소했습니다. 입력 소스를 다시 선택해 주세요';
      }

      cameraOverlay.innerHTML =
        `<p>미디어 연결 실패</p><p class="muted">${userMessage}</p>`;
      startBtn.disabled = true;
    }
  }

  function setupSourceSelectors() {
    const root = document.getElementById('sourceSelect');
    if (!root) return;

    root.querySelectorAll('[data-source]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (state.phase !== 'PREPARING') return;
        const next = btn.getAttribute('data-source');
        if (!next || next === selectedCameraSource) return;
        selectedCameraSource = next;
        root.querySelectorAll('[data-source]').forEach((b) => {
          b.classList.toggle('active', b.getAttribute('data-source') === selectedCameraSource);
        });
        await connectCameraSource(selectedCameraSource);
      });
    });

    root.querySelectorAll('[data-source]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-source') === selectedCameraSource);
    });
  }

  function applySelectedView(nextView) {
    const normalized = normalizeViewCode(nextView);
    const allowed = getAllowedViews();
    const fallback = resolveDefaultView();
    state.selectedView = normalized && allowed.includes(normalized) ? normalized : fallback;

    if (!viewSelectRoot) return;

    viewSelectRoot.querySelectorAll('[data-view]').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === state.selectedView);
    });
  }

  function setupViewSelectors() {
    if (!viewSelectRoot) return;
    applySelectedView(state.selectedView);

    viewSelectRoot.querySelectorAll('[data-view]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (state.phase !== 'PREPARING') return;
        const next = btn.getAttribute('data-view');
        if (!next) return;
        applySelectedView(next);
        if (scoringEngine?.setSelectedView) {
          scoringEngine.setSelectedView(state.selectedView);
        }
      });
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

    try {
      const response = await fetch('/api/workout/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exercise_id: workoutData.exercise.exercise_id,
          selected_view: state.selectedView,
          mode: workoutData.mode,
          routine_id: workoutData.routine?.routine_id || null
        })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || data.message || '세션 시작에 실패했습니다.');
      }

      state.sessionId = data.session.session_id;
      state.selectedView = normalizeViewCode(data.session.selected_view) || state.selectedView;
      hasUnloadAbortSent = false;
      pendingSessionPayload = null;
      if (data.routineInstance) {
        workoutData.routineInstance = data.routineInstance;
      }
      state.phase = 'WORKING';

      sessionBuffer = new SessionBuffer(state.sessionId, {
        exerciseCode: workoutData.exercise.code,
        mode: workoutData.mode,
        selectedView: state.selectedView,
        resultBasis: repCounter?.pattern?.isTimeBased ? 'DURATION' : 'REPS'
      });
      sessionBuffer.addEvent('SESSION_START', {
        exercise: workoutData.exercise.code,
        selected_view: state.selectedView
      });

      updateStatus('running', '운동 중');
      cameraOverlay.hidden = true;
      startBtn.hidden = true;
      const sourceSelectEl = document.getElementById('sourceSelect');
      if (sourceSelectEl) sourceSelectEl.hidden = true;
      if (viewSelectRoot) viewSelectRoot.hidden = true;
      pauseBtn.disabled = false;
      finishBtn.disabled = false;
      finishBtn.textContent = '운동 종료';

      startTimer();
      startPoseDetection();
    } catch (error) {
      console.error('[Session] 시작 에러:', error);
      cameraOverlay.hidden = prevOverlayHidden;
      cameraOverlay.innerHTML = prevOverlayHtml || cameraReadyHtml;
      startBtn.hidden = prevStartHidden;
      startBtn.disabled = prevStartDisabled;
      alert('운동 시작에 실패했습니다: ' + error.message);
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

      if (state.phase !== 'FINISHED') {
        state.frameLoop = requestAnimationFrame(processFrame);
      }
    };

    state.frameLoop = requestAnimationFrame(processFrame);
    console.log('[Session] 포즈 감지 시작');
  }

  function handlePoseDetected(poseData) {
    noPersonCount = 0;

    if (state.phase !== 'WORKING' || state.isPaused) return;

    const { angles } = poseData;
    updateViewInfo(angles);

    const frameGate = getFrameGateResult(angles);
    if (!frameGate.isReady) {
      if (poseEngine && poseEngine.setVisualFeedback) {
        poseEngine.setVisualFeedback([]);
      }
      updateScoreDisplay({ score: 0, breakdown: [], gated: true, message: frameGate.message });
      if (frameGate.message) {
        showAlert('자세 인식 대기', frameGate.message);
      }
      return;
    }

    const rawScoreResult = scoringEngine.calculate(angles);

    const previousCounts = {
      all: repCounter?.currentRepAllScores?.length || 0,
      active: repCounter?.currentRepScores?.length || 0,
      movement: repCounter?.currentMovementScores?.length || 0
    };
    repCounter.update(angles, rawScoreResult.score);
    updateViewInfo(angles);

    const liveScoreResult = getLiveFeedbackResult(rawScoreResult, angles);
    syncRepCounterLatestScores(liveScoreResult.score, previousCounts);

    if (poseEngine && poseEngine.setVisualFeedback) {
      poseEngine.setVisualFeedback(liveScoreResult.breakdown);
    }

    if (liveScoreResult.score > 0) {
      console.log('[Session] 점수:', liveScoreResult.score, 'breakdown:', liveScoreResult.breakdown?.length);
    }

    updateRepMetricBuffer(liveScoreResult);

    updateScoreDisplay(liveScoreResult);

    if (sessionBuffer) {
      sessionBuffer.addScore(liveScoreResult);
    }

    const shouldCheckFeedback = repCounter?.pattern?.isTimeBased ? true : repCounter?.isInProgress();
    if (shouldCheckFeedback) {
      checkFeedback(liveScoreResult);
    }
  }

  function handleNoPerson() {
    if (state.phase !== 'WORKING' || state.isPaused) return;

    noPersonCount++;

    if (noPersonCount === NO_PERSON_THRESHOLD) {
      if (sessionBuffer) {
        sessionBuffer.addEvent('NO_PERSON', {
          duration: noPersonCount,
          message: '카메라에 사람이 감지되지 않습니다'
        });
      }
      showAlert('감지 안됨', '카메라에 전신이 보이도록 해주세요');
    }
  }

  function aggregateScores(scores) {
    if (!scores || scores.length === 0) return 0;
    const sorted = scores
      .filter((s) => typeof s === 'number' && !Number.isNaN(s))
      .slice()
      .sort((a, b) => a - b);
    if (sorted.length === 0) return 0;

    const trimCount = Math.floor(sorted.length * 0.1);
    const trimmed = sorted.length >= 10 ? sorted.slice(trimCount, sorted.length - trimCount) : sorted;
    const sum = trimmed.reduce((a, b) => a + b, 0);
    return Math.round(sum / trimmed.length);
  }

  function syncRepCounterLatestScores(score, previousCounts) {
    if (!repCounter || !Number.isFinite(score)) return;

    const targets = [
      { list: repCounter.currentRepAllScores, previous: previousCounts?.all || 0 },
      { list: repCounter.currentRepScores, previous: previousCounts?.active || 0 },
      { list: repCounter.currentMovementScores, previous: previousCounts?.movement || 0 }
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
      return exerciseModule.filterLiveFeedback(scoreResult, getExerciseRuntime({ angles })) || scoreResult;
    }

    return scoreResult;
  }

  function updateRepMetricBuffer(scoreResult) {
    const isTimeBased = repCounter?.pattern?.isTimeBased;
    if (isTimeBased) return;

    const isRepInProgress = repCounter?.isInProgress ? repCounter.isInProgress() : false;
    if (isRepInProgress && !state.repInProgressPrev) {
      state.repMetricBuffer = {};
    }
    state.repInProgressPrev = isRepInProgress;

    if (!isRepInProgress) return;
    if (exerciseModule?.shouldAccumulateRepMetrics) {
      if (!exerciseModule.shouldAccumulateRepMetrics(getExerciseRuntime({ scoreResult }))) return;
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
          maxScore: item.maxScore,
          scores: []
        };
      }
      state.repMetricBuffer[key].scores.push(item.score);
    }
  }

  function updateViewInfo(angles) {
    if ((!viewInfoEl && !phaseInfoEl) || !angles) return;

    const now = performance.now();
    if (now - state.lastViewInfoAt < 250) return;
    state.lastViewInfoAt = now;

    const view = angles.view || 'UNKNOWN';
    const source = angles.angleSource || 'UNKNOWN';
    const quality = angles.quality?.level || 'UNKNOWN';
    const phase = repCounter?.currentPhase || window.REP_PHASES?.NEUTRAL || 'UNKNOWN';
    const selectedView = state.selectedView || 'N/A';
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
    repCountEl.textContent = state.currentRep;

    state.lastRepMetricSummary =
      Array.isArray(repRecord.breakdown) && repRecord.breakdown.length > 0
        ? repRecord.breakdown.slice()
        : Object.values(state.repMetricBuffer || {})
            .map((m) => ({
              metric_id: m.metric_id,
              key: m.key,
              title: m.title,
              maxScore: m.maxScore,
              score: aggregateScores(m.scores)
            }))
            .sort((a, b) => b.score / (b.maxScore || 1) - a.score / (a.maxScore || 1));

    if (sessionBuffer) {
      sessionBuffer.addRep(repRecord);

      sessionBuffer.addEvent('REP_COMPLETE', {
        repNumber: repRecord.repNumber,
        score: repRecord.score,
        duration: repRecord.duration,
        phase: repRecord.phase || null,
        view: repRecord.view || null,
        selected_view: state.selectedView,
        confidence: repRecord.confidence?.level || null,
        feedback: repRecord.feedback || null
      });
    }

    if (workoutData.mode === 'ROUTINE' && workoutData.routine) {
      checkRoutineProgress();
    }

    showRepFeedback(repRecord);
  }

  function updateScoreDisplay(scoreResult) {
    const isTimeBased = repCounter?.pattern?.isTimeBased;
    const hasAnyRep = repCounter?.getCount ? repCounter.getCount() > 0 : false;
    const isRepInProgress = repCounter?.isInProgress ? repCounter.isInProgress() : false;

    const displayScore = isTimeBased
      ? scoreResult.score
      : (hasAnyRep || isRepInProgress) && repCounter?.getCurrentRepScore
        ? repCounter.getCurrentRepScore()
        : 0;

    state.liveScore = displayScore;
    liveScoreEl.textContent = !isTimeBased && !hasAnyRep && !isRepInProgress ? '--' : displayScore;

    liveScoreEl.style.background = 'none';
    liveScoreEl.style.webkitBackgroundClip = 'unset';
    liveScoreEl.style.webkitTextFillColor = 'unset';

    if (displayScore >= 80) {
      liveScoreEl.style.color = '#22c55e';
    } else if (displayScore >= 60) {
      liveScoreEl.style.color = '#eab308';
    } else if (displayScore > 0) {
      liveScoreEl.style.color = '#ef4444';
    } else {
      liveScoreEl.style.color = '#94a3b8';
    }

    const shouldShowBreakdown = isTimeBased
      ? scoreResult.breakdown && scoreResult.breakdown.length > 0
      : (isRepInProgress && Object.keys(state.repMetricBuffer || {}).length > 0) ||
        (!isRepInProgress && hasAnyRep && state.lastRepMetricSummary?.length > 0);

    if (shouldShowBreakdown) {
      const items = isTimeBased
        ? scoreResult.breakdown
        : isRepInProgress
          ? Object.values(state.repMetricBuffer).map((m) => ({
              key: m.key,
              title: m.title,
              score: aggregateScores(m.scores),
              maxScore: m.maxScore
            }))
          : state.lastRepMetricSummary;

      scoreBreakdownEl.innerHTML = items
        .filter((it) => it && it.maxScore != null)
        .sort((a, b) => b.score / (b.maxScore || 1) - a.score / (a.maxScore || 1))
        .slice(0, 3)
        .map(
          (item) => `
          <div class="score-item">
            <span>${item.title || item.key}</span>
            <span>${Math.round(item.score)}/${item.maxScore}</span>
          </div>
        `
        )
        .join('');
    } else if (scoreResult.gated && scoreResult.message) {
      scoreBreakdownEl.innerHTML = `<div class="score-item"><span class="muted">${scoreResult.message}</span></div>`;
    } else if (scoreResult.score === 0) {
      scoreBreakdownEl.innerHTML = '<div class="score-item"><span class="muted">포즈 감지 중...</span></div>';
    } else if (!isTimeBased && !isRepInProgress) {
      scoreBreakdownEl.innerHTML = '<div class="score-item"><span class="muted">rep 시작하면 표시됩니다</span></div>';
    }
  }

  function checkFeedback(scoreResult) {
    if (state.alertCooldown) return;

    const lowScoreItem = scoreResult.breakdown?.find(
      (item) => item.feedback && item.score < item.maxScore * 0.6
    );

    if (lowScoreItem) {
      showAlert('자세 교정 필요', lowScoreItem.feedback);

      if (sessionBuffer) {
        sessionBuffer.addEvent('LOW_SCORE_HINT', {
          metric_key: lowScoreItem.key,
          score: lowScoreItem.score,
          maxScore: lowScoreItem.maxScore,
          feedback: lowScoreItem.feedback
        });
      }
    }
  }

  function showRepFeedback(repRecord) {
    const msg =
      repRecord.feedback ||
      (repRecord.score >= 80 ? '완벽해요! 👏' : repRecord.score >= 60 ? '좋아요! 👍' : '계속 해보세요!');

    showToast(`${repRecord.repNumber}회 ${msg}`);
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'toast workout-session-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
  }

  function resetStepUiState() {
    state.currentSet = 1;
    state.currentRep = 0;
    state.repMetricBuffer = {};
    state.lastRepMetricSummary = [];
    state.repInProgressPrev = false;
    setCountEl.textContent = 1;
    repCountEl.textContent = 0;
    liveScoreEl.textContent = '--';
    scoreBreakdownEl.innerHTML = '<div class="score-item"><span class="muted">rep 시작하면 표시됩니다.</span></div>';
    if (repCounter) {
      repCounter.reset();
    }
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

    if (!bindEnginesToCurrentExercise()) {
      return false;
    }

    resetStepUiState();

    if (sessionBuffer) {
      sessionBuffer.addEvent('ROUTINE_STEP_CHANGE', {
        stepIndex,
        exercise_id: nextExercise.exercise_id,
        exercise_code: nextExercise.code,
        selected_view: state.selectedView
      });
    }

    return true;
  }

  function checkRoutineProgress() {
    const currentStep = workoutData.routine.routine_setup[state.currentStepIndex];
    if (!currentStep) return;

    if (currentStep.target_type === 'REPS' && state.currentRep >= currentStep.target_value) {
      if (sessionBuffer) {
        sessionBuffer.completeSet(currentStep.rest_sec || 0);
      }

      if (state.currentSet < currentStep.sets) {
        startRest(currentStep.rest_sec || 0);
      } else {
        nextExercise();
      }
    }
  }

  function startTimer() {
    state.timerInterval = setInterval(() => {
      if (!state.isPaused && state.phase === 'WORKING') {
        state.totalTime++;
        updateTimerDisplay();
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    const mins = Math.floor(state.totalTime / 60);
    const secs = state.totalTime % 60;
    timerValueEl.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  function updateStatus(className, text) {
    statusBadge.className = 'status ' + className;
    statusBadge.textContent = text;
  }

  function togglePause() {
    state.isPaused = !state.isPaused;

    if (state.isPaused) {
      state.phase = 'PAUSED';
      updateStatus('paused', '일시정지');
      pauseBtn.innerHTML = '계속하기';
      if (poseEngine) poseEngine.stop();
      if (sessionBuffer) sessionBuffer.addEvent('PAUSE');
    } else {
      state.phase = 'WORKING';
      updateStatus('running', '운동 중');
      pauseBtn.innerHTML = '일시정지';
      if (poseEngine) poseEngine.start();
      if (sessionBuffer) sessionBuffer.addEvent('RESUME');
    }
  }

  function startRest(seconds) {
    state.phase = 'RESTING';
    state.restTimeLeft = seconds;
    updateStatus('rest', '휴식 중');
    timerLabelEl.textContent = '휴식 시간';
    restTimerEl.hidden = false;
    restValueEl.textContent = seconds;

    if (poseEngine) poseEngine.stop();
    if (sessionBuffer) sessionBuffer.addEvent('REST_START', { duration: seconds });

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
    state.phase = 'WORKING';
    timerLabelEl.textContent = '운동 시간';
    updateStatus('running', '운동 중');

    state.currentSet++;
    setCountEl.textContent = state.currentSet;
    state.currentRep = 0;
    repCountEl.textContent = 0;

    if (repCounter) {
      repCounter.repCount = 0;
    }

    if (poseEngine) poseEngine.start();
    if (sessionBuffer) sessionBuffer.addEvent('REST_END');

    showAlert('다음 세트', `${state.currentSet}세트 시작!`);
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
    state.currentStepIndex++;
    const routineSteps = workoutData.routine.routine_setup;

    if (state.currentStepIndex >= routineSteps.length) {
      finishWorkout();
      return;
    }

    const switched = switchRoutineStep(state.currentStepIndex);
    if (!switched) {
      showAlert('루틴 오류', '다음 운동의 채점 설정을 불러오지 못했습니다.');
      finishWorkout();
      return;
    }

    const progress = (state.currentStepIndex / routineSteps.length) * 100;
    document.getElementById('routineProgress').style.width = `${progress}%`;
    document.getElementById('routineStep').textContent =
      `${state.currentStepIndex + 1} / ${routineSteps.length} 운동`;

    state.currentSet = 1;
    state.currentRep = 0;
    setCountEl.textContent = 1;
    repCountEl.textContent = 0;

    if (repCounter) repCounter.reset();
    if (sessionBuffer) {
      sessionBuffer.addEvent('NEXT_EXERCISE', {
        stepIndex: state.currentStepIndex,
        exercise_code: workoutData.exercise?.code || null
      });
    }

    showAlert('다음 운동', routineSteps[state.currentStepIndex].exercise?.name || '다음 운동');
  }

  async function finishWorkout() {
    if (!state.sessionId || isEndingSession) return;
    isEndingSession = true;
    finishBtn.disabled = true;
    finishBtn.textContent = '저장 중...';
    pauseBtn.disabled = true;

    state.phase = 'FINISHED';
    clearInterval(state.timerInterval);
    clearInterval(state.restInterval);
    if (state.frameLoop) {
      cancelAnimationFrame(state.frameLoop);
    }
    if (poseEngine) {
      poseEngine.destroy();
    }
    sessionCamera.destroy();

    updateStatus('finished', '완료');

    try {
      const sessionData =
        pendingSessionPayload ||
        (sessionBuffer
          ? sessionBuffer.export()
          : {
              selected_view: state.selectedView,
              result_basis: 'REPS',
              total_result_value: state.currentRep,
              total_result_unit: 'COUNT',
              duration_sec: state.totalTime,
              total_reps: state.currentRep,
              final_score: state.liveScore || 0,
              summary_feedback: generateSummary()
            });
      pendingSessionPayload = sessionData;

      const response = await fetch(`/api/workout/session/${state.sessionId}/end`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sessionData)
      });

      const responseBody = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(responseBody.error || responseBody.message || '세션 종료 실패');
      }

      if (sessionBuffer) {
        sessionBuffer.clearStorage();
      }
      pendingSessionPayload = null;
      window.location.href = `/workout/result/${state.sessionId}`;
    } catch (error) {
      console.error('[Session] 종료 에러:', error);
      showAlert('저장 실패', '운동 결과 저장에 실패했습니다. 종료 버튼을 다시 눌러 재시도해 주세요.');
      finishBtn.disabled = false;
      finishBtn.textContent = '저장 재시도';
    } finally {
      isEndingSession = false;
    }
  }

  function generateSummary() {
    if (state.liveScore >= 80) {
      return '훌륭해요! 자세가 매우 좋습니다.';
    }
    if (state.liveScore >= 60) {
      return '좋아요! 조금만 더 신경쓰면 완벽해요.';
    }
    return '자세 교정이 필요합니다. 운동 배우기를 확인해보세요.';
  }

  function confirmExit() {
    if (state.phase === 'PREPARING') {
      window.location.href = workoutData.mode === 'ROUTINE' ? '/routine' : '/workout/free';
    } else {
      document.getElementById('exitModal').hidden = false;
    }
  }

  function closeExitModal() {
    document.getElementById('exitModal').hidden = true;
  }

  function forceExit() {
    finishWorkout();
  }

  function sendAbortBeacon(reason = 'UNLOAD') {
    if (!state.sessionId || hasUnloadAbortSent || state.phase === 'FINISHED') {
      return;
    }

    hasUnloadAbortSent = true;
    const payload = JSON.stringify({
      reason,
      selected_view: state.selectedView,
      duration_sec: state.totalTime || 0,
      total_reps: state.currentRep || 0
    });
    const url = `/api/workout/session/${state.sessionId}/abort`;

    if (navigator.sendBeacon) {
      const blob = new Blob([payload], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
      return;
    }

    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true
    }).catch(() => {});
  }

  window.addEventListener('beforeunload', () => {
    if (state.phase === 'WORKING' || state.phase === 'RESTING' || state.phase === 'PAUSED') {
      if (sessionBuffer) sessionBuffer.saveToStorage();
      sendAbortBeacon('UNLOAD');
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
  await connectCameraSource(selectedCameraSource);
}

window.initSession = initSession;
