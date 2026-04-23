/**
 * session-ui.js
 *
 * 운동 세션 UI 업데이트를 담당하는 팩토리 모듈.
 * DOM 요소 참조(refs)를 받아 UI 조작 메서드를 제공하는 객체를 생성합니다.
 * session-controller.js에서 인스턴스화하여 사용합니다.
 *
 * @param {Object} deps
 * @param {Object} deps.refs - DOM 요소 참조 객체
 * @param {Function} deps.createElement - document.createElement 바인딩
 * @param {Function} deps.formatClock - 초를 MM:SS로 포맷하는 함수
 * @returns {Object} UI 조작 메서드들
 */
function createSessionUi({
  refs,
  createElement = typeof document !== 'undefined'
    ? document.createElement.bind(document)
    : null,
  formatClock,
}) {
  void formatClock;

  /**
   * 상태 뱃지(PREPARING/WORKING 등)의 클래스와 텍스트를 업데이트합니다.
   * @param {string} className - CSS 클래스명 (running, paused 등)
   * @param {string} text - 표시 텍스트
   */
  function updateStatus(className, text) {
    if (!refs.statusBadge) return;
    refs.statusBadge.className = `status ${className}`;
    refs.statusBadge.textContent = text;
  }

  /**
   * 알림(alert)을 표시합니다.
   * @param {string} title - 알림 제목
   * @param {string} message - 알림 내용
   */
  function showAlert(title, message) {
    if (!refs.alertContainer || !refs.alertTitle || !refs.alertMessage) return;
    refs.alertTitle.textContent = title;
    refs.alertMessage.textContent = message;
    refs.alertContainer.hidden = false;
  }

  /** 알림(alert)을 숨깁니다. */
  function hideAlert() {
    if (refs.alertContainer) {
      refs.alertContainer.hidden = true;
    }
  }

  /**
   * 토스트 메시지를 화면 하단에 일시적으로 표시합니다 (2초 후 자동 제거).
   * @param {string} message - 토스트 메시지
   * @returns {HTMLElement|null} 생성된 토스트 요소
   */
  function showToast(message) {
    if (typeof createElement !== 'function') return null;

    const toast = createElement('div');
    toast.className = 'toast workout-session-toast';
    toast.textContent = message;

    if (typeof document !== 'undefined' && document.body?.appendChild) {
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    }

    return toast;
  }

  /**
   * 루틴 프로그레스 UI를 최초 구성합니다.
   * 각 운동 단계(step)를 칩(chip) 형태로 DOM에 동적 생성합니다.
   * @param {Object} params
   * @param {Array} params.steps - [{ exerciseName, targetSummary }]
   */
  function setupRoutineProgressUi({ steps = [] }) {
    if (!refs.routineProgressEl || !refs.routineStepEl || typeof createElement !== 'function') {
      return;
    }

    const card = refs.routineProgressEl.closest?.('.progress-card');
    const progressTrack = refs.routineProgressEl.parentElement;
    const labelEl = card?.querySelector?.('span.muted:not(#routineStep)');
    if (!card || !progressTrack || !labelEl || card.dataset.enhanced === 'true') {
      return;
    }

    card.dataset.enhanced = 'true';
    card.classList.add('routine-progress-card');
    progressTrack.classList.add('routine-progress-track');

    const header = createElement('div');
    header.className = 'routine-progress-header';

    const titleGroup = createElement('div');
    titleGroup.className = 'routine-progress-title-group';
    refs.routineCurrentExerciseEl = createElement('strong');
    refs.routineCurrentExerciseEl.className = 'routine-progress-current';
    titleGroup.append(labelEl, refs.routineCurrentExerciseEl);

    const stats = createElement('div');
    stats.className = 'routine-progress-stats';
    refs.routineProgressCountEl = createElement('strong');
    refs.routineProgressCountEl.className = 'routine-progress-count';
    refs.routineProgressPercentEl = createElement('span');
    refs.routineProgressPercentEl.className = 'routine-progress-percent';
    stats.append(refs.routineProgressCountEl, refs.routineProgressPercentEl);
    header.append(titleGroup, stats);

    const meta = createElement('div');
    meta.className = 'routine-progress-meta';
    refs.routineTargetSummaryEl = createElement('span');
    refs.routineTargetSummaryEl.className = 'routine-progress-target';
    meta.append(refs.routineStepEl, refs.routineTargetSummaryEl);

    refs.routineStepListEl = createElement('div');
    refs.routineStepListEl.className = 'routine-step-list';
    refs.routineStepListEl.setAttribute('aria-label', '루틴 단계');

    steps.forEach((step, index) => {
      const chip = createElement('div');
      chip.className = 'routine-step-chip';
      chip.setAttribute('data-routine-step-index', String(index));

      const chipIndex = createElement('span');
      chipIndex.className = 'routine-step-index';
      chipIndex.textContent = String(index + 1);

      const chipCopy = createElement('div');
      chipCopy.className = 'routine-step-copy';

      const chipTitle = createElement('strong');
      chipTitle.textContent = step.exerciseName;

      const chipMeta = createElement('span');
      chipMeta.textContent = step.targetSummary;

      chipCopy.append(chipTitle, chipMeta);
      chip.append(chipIndex, chipCopy);
      refs.routineStepListEl.append(chip);
    });

    card.replaceChildren(header, progressTrack, meta, refs.routineStepListEl);
  }

  /**
   * 메인 카운터 UI를 업데이트합니다.
   * 시간 기반 운동이면 초(sec), 횟수 기반이면 rep 수를 표시합니다.
   * @param {Object} params
   * @param {boolean} params.isTimeBased - 현재 운동이 시간 기반인지
   * @param {boolean} params.isRoutineTimeTarget - 루틴 목표가 시간 기반인지
   * @param {number} params.currentSegmentSec - 현재 세그먼트 시간
   * @param {number} params.currentSetWorkSec - 현재 세트 작업 시간
   * @param {number} params.currentRep - 현재 반복 횟수
   */
  function updatePrimaryCounterDisplay({
    isTimeBased,
    isRoutineTimeTarget,
    currentSegmentSec,
    currentSetWorkSec,
    currentRep,
  }) {
    if (refs.repCountLabelEl) {
      refs.repCountLabelEl.textContent =
        isTimeBased || isRoutineTimeTarget ? '시간(초)' : '횟수';
    }

    const value = isTimeBased
      ? Math.max(0, Math.round(currentSegmentSec))
      : isRoutineTimeTarget
        ? Math.max(0, Math.round(currentSetWorkSec))
        : Math.max(0, Math.round(currentRep));

    if (refs.repCountEl) {
      refs.repCountEl.textContent = String(value);
    }
  }

  /**
   * 루틴 단계 프로그레스 표시를 업데이트합니다.
   * 현재 단계/전체 단계 수, 진행률 퍼센트, 완료 칩 하이라이트 등을 반영합니다.
   * @param {Object} params
   * @param {number} params.stepIndex - 현재 단계 인덱스
   * @param {number} params.totalSteps - 총 단계 수
   * @param {number} params.progressPercent - 진행률(%)
   * @param {string} params.currentExerciseName - 현재 운동 이름
   * @param {string} params.targetSummary - 목표 요약 텍스트
   */
  function updateRoutineStepDisplay({
    stepIndex,
    totalSteps,
    progressPercent,
    currentExerciseName,
    targetSummary,
  }) {
    if (refs.routineStepEl) {
      refs.routineStepEl.textContent = `현재 ${stepIndex + 1} / ${totalSteps} 운동`;
    }
    if (refs.routineProgressEl) {
      refs.routineProgressEl.style.width = `${progressPercent}%`;
    }
    if (refs.routineProgressCountEl) {
      refs.routineProgressCountEl.textContent = `${stepIndex + 1} / ${totalSteps}`;
    }
    if (refs.routineProgressPercentEl) {
      refs.routineProgressPercentEl.textContent = `${progressPercent}%`;
    }
    if (refs.routineCurrentExerciseEl) {
      refs.routineCurrentExerciseEl.textContent = currentExerciseName;
    }
    if (refs.routineTargetSummaryEl) {
      refs.routineTargetSummaryEl.textContent = targetSummary;
    }
    if (refs.routineStepListEl) {
      refs.routineStepListEl
        .querySelectorAll('[data-routine-step-index]')
        .forEach((chip) => {
          const chipIndex = Number(chip.getAttribute('data-routine-step-index'));
          chip.classList.toggle('is-complete', chipIndex < stepIndex);
          chip.classList.toggle('is-active', chipIndex === stepIndex);
          chip.classList.toggle('is-upcoming', chipIndex > stepIndex);

          if (chipIndex === stepIndex) {
            chip.setAttribute('aria-current', 'step');
          } else {
            chip.removeAttribute('aria-current');
          }
        });
    }
  }

  /**
   * 점수 UI를 업데이트합니다.
   * 점수 값, 색상, breakdown(메트릭별 점수 최대 3개)을 표시합니다.
   * gated 상태이면 품질 게이트 보류 메시지를 표시합니다.
   * @param {Object} params
   * @param {number} params.score - 점수
   * @param {string} params.displayText - 표시 텍스트 (기본: score 문자열)
   * @param {Array} params.breakdown - 메트릭별 점수 배열 [{ title, key, score, normalizedScore }]
   * @param {boolean} params.gated - 품질 게이트 보류 중인지
   * @param {string} params.message - 게이트 보류 메시지
   * @param {string} params.emptyMessage - breakdown이 없을 때 표시할 메시지
   * @param {string} params.color - 점수 색상
   */
  function updateScoreDisplay({
    score,
    displayText = score > 0 ? String(score) : '--',
    breakdown = [],
    gated = false,
    message = null,
    emptyMessage = '포즈 감지 중...',
    color = '#94a3b8',
  }) {
    if (refs.liveScoreEl) {
      refs.liveScoreEl.textContent = displayText;
      refs.liveScoreEl.style.background = 'none';
      refs.liveScoreEl.style.webkitBackgroundClip = 'unset';
      refs.liveScoreEl.style.webkitTextFillColor = 'unset';
      refs.liveScoreEl.style.color = color;
    }

    if (!refs.scoreBreakdownEl) return;

    if (gated && message) {
      refs.scoreBreakdownEl.innerHTML = `<div class="score-item"><span class="muted">${message}</span></div>`;
      return;
    }

    if (!breakdown.length) {
      refs.scoreBreakdownEl.innerHTML = `<div class="score-item"><span class="muted">${emptyMessage}</span></div>`;
      return;
    }

    refs.scoreBreakdownEl.innerHTML = breakdown
      .slice(0, 3)
      .map((item) => `
        <div class="score-item">
          <span>${item.title || item.key}</span>
          <span>${Math.round(item.score ?? item.normalizedScore ?? 0)}</span>
        </div>
      `)
      .join('');
  }

  /**
   * 플랭크 목표 시간 선택 UI를 동기화합니다.
   * - 루틴 모드: 자동 적용 (버튼/입력 비활성화)
   * - 자유 모드: 수동 선택 가능 (PREPARING 상태에서만)
   * @param {Object} params
   * @param {boolean} params.isPlank - 플랭크 운동인지
   * @param {boolean} params.isRoutinePlank - 루틴 모드 플랭크인지
   * @param {boolean} params.showFreeTargetUi - 자유 모드 목표 선택 UI 표시 여부
   * @param {number} params.targetSec - 목표 시간(초)
   * @param {boolean} params.canStart - 시작 가능 여부
   * @param {string} params.phase - 현재 페이즈
   */
  function syncPlankTargetUi({
    isPlank,
    isRoutinePlank,
    showFreeTargetUi,
    targetSec,
    canStart,
    phase,
  }) {
    if (refs.plankTargetSelectRoot) {
      refs.plankTargetSelectRoot.hidden = !showFreeTargetUi;
      refs.plankTargetSelectRoot
        .querySelectorAll('[data-plank-target-sec]')
        .forEach((button) => {
          const buttonSec = Number(button.getAttribute('data-plank-target-sec'));
          button.classList.toggle('active', buttonSec === targetSec);
          button.disabled = isRoutinePlank;
        });
    }

    if (refs.plankTargetInput) {
      if (targetSec > 0) refs.plankTargetInput.value = String(targetSec);
      refs.plankTargetInput.disabled = isRoutinePlank;
    }

    if (refs.plankTargetHint) {
      refs.plankTargetHint.textContent = isRoutinePlank
        ? `루틴 목표 시간 ${targetSec}초가 자동으로 적용됩니다.`
        : '플랭크는 목표 시간을 먼저 정한 뒤 시작합니다. 목표 시간은 세션 종료 시 점수 정규화 기준이 됩니다.';
    }

    if (refs.plankTargetReadoutEl) {
      refs.plankTargetReadoutEl.textContent = targetSec > 0 ? `${targetSec}초` : '--';
    }

    if (refs.scoreModeLabelEl) {
      refs.scoreModeLabelEl.textContent = isPlank ? '현재 자세 점수' : '이번 rep 점수';
    }
    if (refs.timerLabelEl) {
      refs.timerLabelEl.textContent = isPlank ? '플랭크 시간' : '운동 시간';
    }
    if (refs.startBtn && phase === 'PREPARING') {
      refs.startBtn.textContent = isPlank ? '플랭크 시작' : '운동 시작';
      refs.startBtn.disabled = !canStart;
    }
  }

  /**
   * 플랭크 런타임 표시를 업데이트합니다.
   * 현재 유지 시간, 최고 유지 시간, 진행률, phase 라벨 등을 반영합니다.
   * @param {Object} params
   * @param {number} params.bestHoldSec - 최고 유지 시간(초)
   * @param {number} params.currentSegmentSec - 현재 세그먼트 시간(초)
   * @param {boolean} params.goalReached - 목표 달성 여부
   * @param {boolean} params.isPlank - 플랭크 운동인지
   * @param {string} params.phase - 현재 phase (SETUP/HOLD/BREAK)
   * @param {number} params.progressPercent - 진행률(%)
   * @param {number} params.targetSec - 목표 시간(초)
   */
  function updatePlankRuntimeDisplay({
    bestHoldSec,
    currentSegmentSec,
    goalReached,
    isPlank,
    phase,
    progressPercent,
    targetSec,
  }) {
    if (refs.plankRuntimePanelEl) {
      refs.plankRuntimePanelEl.hidden = !isPlank;
    }
    if (refs.plankTimerPanelEl) {
      refs.plankTimerPanelEl.hidden = !isPlank;
    }
    if (!isPlank) return;

    if (refs.plankCurrentHoldEl) {
      refs.plankCurrentHoldEl.textContent = formatClock(currentSegmentSec);
    }
    if (refs.plankBestHoldEl) {
      refs.plankBestHoldEl.textContent = formatClock(bestHoldSec);
    }
    if (refs.plankPhaseInfoEl) {
      refs.plankPhaseInfoEl.textContent = phase;
    }
    if (refs.plankStateLabelEl) {
      refs.plankStateLabelEl.textContent = phase;
    }
    if (refs.plankSegmentLabelEl) {
      refs.plankSegmentLabelEl.textContent = formatClock(currentSegmentSec);
    }
    if (refs.plankTargetReadoutEl) {
      refs.plankTargetReadoutEl.textContent = targetSec > 0 ? `${targetSec}초` : '--';
    }
    if (refs.plankGoalLabelEl) {
      refs.plankGoalLabelEl.textContent = goalReached
        ? '달성'
        : targetSec > 0
          ? `${Math.max(0, targetSec - bestHoldSec)}초 남음`
          : '대기 중';
    }
    if (refs.plankProgressEl) {
      refs.plankProgressEl.style.width = `${progressPercent}%`;
    }
  }

  return {
    hideAlert,
    showAlert,
    showToast,
    setupRoutineProgressUi,
    syncPlankTargetUi,
    updatePlankRuntimeDisplay,
    updatePrimaryCounterDisplay,
    updateRoutineStepDisplay,
    updateScoreDisplay,
    updateStatus,
  };
}

if (typeof window !== 'undefined') {
  window.createSessionUi = createSessionUi;
}

if (typeof module !== 'undefined') {
  module.exports = { createSessionUi };
}
