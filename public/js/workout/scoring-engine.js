/**
 * FitPlus Scoring Engine - 실시간 점수 계산
 * DB의 scoring_profile_metric 기반 점수 산출
 */

class ScoringEngine {
  /**
   * @param {Object} scoringProfile - DB에서 가져온 채점 프로파일
   *   - scoring_profile_id
   *   - scoring_profile_metric[] (weight, max_score, rule, metric)
   */
  constructor(scoringProfile, options = {}) {
    this.profile = scoringProfile;
    this.exerciseCode = this.normalizeExerciseCode(options.exerciseCode);
    this.exerciseModule = window.WorkoutExerciseRegistry?.get(this.exerciseCode) || null;
    this.selectedView = this.normalizeSelectedView(options.selectedView);
    const moduleFallbackMetrics = this.exerciseModule?.getDefaultProfileMetrics?.() || [];
    this.metrics = scoringProfile?.scoring_profile_metric?.length
      ? scoringProfile.scoring_profile_metric
      : moduleFallbackMetrics;

    // 점수 히스토리 (평균 계산용)
    this.scoreHistory = [];
    this.maxHistoryLength = 30; // 최근 30프레임

    console.log('[ScoringEngine] 초기화:', this.metrics.length, '개 지표');
    console.log('[ScoringEngine] 프로필:', scoringProfile);
  }

  normalizeSelectedView(view) {
    const normalized = (view || '')
      .toString()
      .trim()
      .toUpperCase();
    return ['FRONT', 'SIDE', 'DIAGONAL'].includes(normalized) ? normalized : null;
  }

  setSelectedView(view) {
    this.selectedView = this.normalizeSelectedView(view);
  }

  normalizeExerciseCode(code) {
    return (code || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/-/g, '_');
  }

  /**
   * 현재 포즈에 대한 점수 계산
   * @param {Object} angles - PoseEngine에서 계산된 각도들
   * @returns {Object} { score, breakdown }
   */
  calculate(angles) {
    if (!this.metrics.length || !angles) {
      return { score: 0, breakdown: [] };
    }

    const breakdown = [];
    let totalScore = 0;
    let totalWeight = 0;

    for (const pm of this.metrics) {
      const metric = pm.metric;
      const rule = pm.rule || {};

      // 메트릭 키에 해당하는 실제 값 추출
      const actualValue = this.getMetricValue(angles, metric.key);

      if (actualValue === null) {
        continue; // 해당 각도를 계산할 수 없는 경우 스킵
      }

      // 규칙에 따른 점수 계산
      const metricScore = this.evaluateMetric(actualValue, rule, pm.max_score);

      const normalizedScore = Number.isFinite(Number(pm.max_score)) && Number(pm.max_score) > 0
        ? Math.max(0, Math.min(100, (metricScore / Number(pm.max_score)) * 100))
        : null;

      breakdown.push({
        metric_id: metric.metric_id,
        key: metric.key,
        title: metric.title,
        unit: metric.unit,
        actualValue,
        score: metricScore,
        normalizedScore,
        maxScore: pm.max_score,
        weight: pm.weight,
        feedback: metricScore < pm.max_score * 0.7 ?
          this.generateFeedback(metric.key, actualValue, rule) : null
      });

      totalScore += metricScore;
      totalWeight += pm.max_score;
    }

    const finalScore = totalWeight > 0
      ? Math.round((totalScore / totalWeight) * 100)
      : 0;

    // 히스토리에 추가
    this.scoreHistory.push(finalScore);
    if (this.scoreHistory.length > this.maxHistoryLength) {
      this.scoreHistory.shift();
    }

    return {
      score: finalScore,
      breakdown,
      timestamp: Date.now()
    };
  }

  /**
   * 메트릭 키에 해당하는 실제 각도 값 추출
   * DB의 metric.key와 angles 객체를 매핑
   */
  getMetricValue(angles, metricKey) {
    if (!angles) return null;

    const combineAngles = (left, right, options = {}) => {
      const l = Number.isFinite(left) ? left : null;
      const r = Number.isFinite(right) ? right : null;
      if (l == null && r == null) return null;
      if (l == null) return r;
      if (r == null) return l;

      const diff = Math.abs(l - r);
      if (diff > (options.maxDiff ?? 35)) {
        return options.preferHighOnMismatch ? Math.max(l, r) : (l + r) / 2;
      }
      return (l + r) / 2;
    };

    // metric.key와 angles 프로퍼티 매핑
    const keyMapping = {
      // 무릎 관련
      'knee_angle': () => {
        const left = angles.leftKnee;
        const right = angles.rightKnee;
        if (left == null && right == null) return null;
        if (left == null) return right;
        if (right == null) return left;
        return (left + right) / 2;
      },
      'left_knee_angle': () => angles.leftKnee,
      'right_knee_angle': () => angles.rightKnee,
      'knee_depth': () => {
        const left = angles.leftKnee;
        const right = angles.rightKnee;
        if (left == null || right == null) return left || right || null;
        return (left + right) / 2;
      },

      // 엉덩이/힙 관련
      'hip_angle': () => {
        const left = angles.leftHip;
        const right = angles.rightHip;
        if (left == null && right == null) return null;
        if (left == null) return right;
        if (right == null) return left;
        return Math.min(left, right);
      },
      'left_hip_angle': () => angles.leftHip,
      'right_hip_angle': () => angles.rightHip,
      'hip_hinge': () => {
        const left = angles.leftHip;
        const right = angles.rightHip;
        if (left == null || right == null) return left || right || null;
        return (left + right) / 2;
      },

      // 팔꿈치 관련
      'elbow_angle': () => {
        const left = angles.leftElbow;
        const right = angles.rightElbow;
        return combineAngles(left, right, { preferHighOnMismatch: true });
      },
      'elbow_depth': () => {
        const left = angles.leftElbow;
        const right = angles.rightElbow;
        return combineAngles(left, right, { preferHighOnMismatch: true });
      },
      'elbow_lockout': () => {
        const left = angles.leftElbow;
        const right = angles.rightElbow;
        return combineAngles(left, right, { preferHighOnMismatch: true });
      },
      'elbow_support_angle': () => {
        const left = angles.leftElbow;
        const right = angles.rightElbow;
        if (left == null && right == null) return null;
        if (left == null) return right;
        if (right == null) return left;
        return Math.min(left, right);
      },
      'left_elbow_angle': () => angles.leftElbow,
      'right_elbow_angle': () => angles.rightElbow,

      // 어깨 관련
      'shoulder_angle': () => {
        const left = angles.leftShoulder;
        const right = angles.rightShoulder;
        if (left == null && right == null) return null;
        if (left == null) return right;
        if (right == null) return left;
        return Math.max(left, right); // 어깨는 높은 값이 올린 상태
      },
      'left_shoulder_angle': () => angles.leftShoulder,
      'right_shoulder_angle': () => angles.rightShoulder,

      // 척추/상체 관련
      'spine_angle': () => angles.spine,
      'torso_angle': () => angles.spine,
      'back_angle': () => angles.spine,

      // 대칭 관련 (좌우 차이값 반환)
      'knee_symmetry': () => {
        const left = angles.leftKnee;
        const right = angles.rightKnee;
        if (left == null || right == null) return null;
        return Math.abs(left - right);
      },
      'elbow_symmetry': () => {
        const left = angles.leftElbow;
        const right = angles.rightElbow;
        if (left == null || right == null) return null;
        return Math.abs(left - right);
      },
      'shoulder_symmetry': () => {
        const left = angles.leftShoulder;
        const right = angles.rightShoulder;
        if (left == null || right == null) return null;
        return Math.abs(left - right);
      },

      // 정렬 관련
      'knee_alignment': () => angles.kneeAlignment?.isAligned ? 100 : 50,
      'knee_over_toe': () => {
        if (!angles.kneeAlignment) return null;
        const avg = (Math.abs(angles.kneeAlignment.left || 0) +
          Math.abs(angles.kneeAlignment.right || 0)) / 2;
        return Math.max(0, 100 - avg * 500); // 정렬 점수로 변환
      },

      // 깊이/시간 관련
      'depth': () => {
        // 스쿼트 깊이를 무릎 각도로 환산 (180도=0%, 90도=100%)
        const knee = angles.leftKnee != null ? angles.leftKnee : angles.rightKnee;
        if (knee == null) return null;
        return Math.max(0, Math.min(100, (180 - knee) / 0.9));
      },
      'hold_time': () => null, // 시간 기반은 별도 처리
      'tempo': () => null // 템포는 별도 처리
    };

    const getter = keyMapping[metricKey];
    if (getter) {
      const value = getter();
      return value !== null && !isNaN(value) ? value : null;
    }

    // 직접 매핑 시도
    if (angles[metricKey] !== undefined) {
      return angles[metricKey];
    }

    console.warn(`[ScoringEngine] 알 수 없는 메트릭 키: ${metricKey}`);
    return null;
  }

  /**
   * 규칙에 따른 점수 평가
   * @param {number} value - 실제 측정값
   * @param {Object} rule - DB의 rule JSON
   *   예: { ideal_min: 85, ideal_max: 95, acceptable_min: 70, acceptable_max: 110 }
   *   예: { type: 'symmetry', compare: ['leftKnee', 'rightKnee'], max_diff: 10 }
   * @param {number} maxScore - 최대 점수
   */
  evaluateMetric(value, rule, maxScore) {
    if (!rule || Object.keys(rule).length === 0) {
      // 규칙이 없으면 기본 점수 부여
      return Math.round(maxScore * 0.7);
    }

    // DB 규칙 타입에 따른 분기
    const ruleType = rule.type;

    // 대칭 타입 (좌우 차이)
    if (ruleType === 'symmetry') {
      return this.evaluateSymmetry(value, rule, maxScore);
    }

    // 위치 타입
    if (ruleType === 'position') {
      return this.evaluatePosition(value, rule, maxScore);
    }

    // 홀드 타입 (자세 유지)
    if (ruleType === 'hold') {
      return this.evaluateHold(value, rule, maxScore);
    }

    // 템포 타입
    if (ruleType === 'tempo') {
      return this.evaluateTempo(value, rule, maxScore);
    }

    // 범위 기반 평가 (ideal_min/ideal_max 또는 min/max 사용)
    if (rule.ideal_min !== undefined || rule.ideal_max !== undefined) {
      return this.evaluateIdealRange(value, rule, maxScore);
    }

    // 기존 range/threshold/optimal 타입도 지원
    switch (ruleType) {
      case 'range':
        return this.evaluateRange(value, rule, maxScore);
      case 'threshold':
        return this.evaluateThreshold(value, rule, maxScore);
      case 'optimal':
        return this.evaluateOptimal(value, rule, maxScore);
      case 'boolean':
        return value ? maxScore : 0;
      default:
        // 기본: ideal 범위 평가 시도
        return this.evaluateIdealRange(value, rule, maxScore);
    }
  }

  /**
   * ideal 범위 기반 평가 (DB 구조에 맞춤)
   * rule: { ideal_min: 85, ideal_max: 95, acceptable_min: 70, acceptable_max: 110 }
   */
  evaluateIdealRange(value, rule, maxScore) {
    const idealMin = rule.ideal_min ?? 0;
    const idealMax = rule.ideal_max ?? 180;
    const acceptableMin = rule.acceptable_min ?? idealMin - 20;
    const acceptableMax = rule.acceptable_max ?? idealMax + 20;

    // ideal 범위 내: 만점
    if (value >= idealMin && value <= idealMax) {
      return maxScore;
    }

    // acceptable 범위 내: 비례 감점
    if (value >= acceptableMin && value < idealMin) {
      const ratio = (value - acceptableMin) / (idealMin - acceptableMin);
      return Math.round(maxScore * (0.6 + 0.4 * ratio));
    }

    if (value > idealMax && value <= acceptableMax) {
      const ratio = (acceptableMax - value) / (acceptableMax - idealMax);
      return Math.round(maxScore * (0.6 + 0.4 * ratio));
    }

    // acceptable 범위 밖: 큰 감점
    if (value < acceptableMin) {
      const deficit = acceptableMin - value;
      return Math.max(0, Math.round(maxScore * 0.3 - deficit));
    }

    if (value > acceptableMax) {
      const excess = value - acceptableMax;
      return Math.max(0, Math.round(maxScore * 0.3 - excess));
    }

    return Math.round(maxScore * 0.5);
  }

  /**
   * 대칭 평가 (좌우 차이)
   * rule: { type: 'symmetry', compare: ['leftKnee', 'rightKnee'], max_diff: 10 }
   */
  evaluateSymmetry(diffValue, rule, maxScore) {
    const maxDiff = rule.max_diff || 15;

    if (diffValue == null) return Math.round(maxScore * 0.7);

    if (diffValue <= maxDiff) {
      return maxScore;
    } else {
      const excess = diffValue - maxDiff;
      const penalty = Math.min(excess * 3, maxScore * 0.7);
      return Math.max(0, Math.round(maxScore - penalty));
    }
  }

  /**
   * 위치 평가
   * rule: { type: 'position', check: 'knee_over_toe', max_forward: 0.1 }
   */
  evaluatePosition(value, rule, maxScore) {
    // 위치 값은 이미 0-100 점수로 변환됨
    if (value == null) return Math.round(maxScore * 0.7);
    return Math.round((value / 100) * maxScore);
  }

  /**
   * 홀드 평가 (자세 유지)
   * rule: { type: 'hold', min_hold_sec: 1, stability_threshold: 5 }
   */
  evaluateHold(value, rule, maxScore) {
    // 시간 기반은 별도 로직 필요, 여기서는 자세 안정성만 평가
    if (value == null) return Math.round(maxScore * 0.7);
    const threshold = rule.stability_threshold || 10;

    if (value <= threshold) {
      return maxScore;
    } else {
      const excess = value - threshold;
      return Math.max(0, Math.round(maxScore - excess * 5));
    }
  }

  /**
   * 템포 평가
   * rule: { type: 'tempo', min_duration_ms: 1500, max_duration_ms: 4000 }
   */
  evaluateTempo(value, rule, maxScore) {
    // 템포는 rep-counter에서 duration으로 처리
    // 여기서는 기본 점수 반환
    return Math.round(maxScore * 0.7);
  }

  /**
   * 범위 기반 평가 (기존 호환)
   * rule: { type: 'range', min: 85, max: 95, optimal: 90 }
   */
  evaluateRange(value, rule, maxScore) {
    const { min, max, optimal } = rule;

    // 최적값에 가까울수록 높은 점수
    if (optimal !== undefined) {
      const deviation = Math.abs(value - optimal);
      const maxDeviation = Math.max(optimal - min, max - optimal);
      const score = maxScore * (1 - (deviation / maxDeviation));
      return Math.max(0, Math.round(score));
    }

    // 범위 내에 있으면 만점, 벗어나면 감점
    if (value >= min && value <= max) {
      return maxScore;
    } else if (value < min) {
      const deficit = min - value;
      return Math.max(0, maxScore - deficit * 2);
    } else {
      const excess = value - max;
      return Math.max(0, maxScore - excess * 2);
    }
  }

  /**
   * 임계값 기반 평가
   * rule: { type: 'threshold', value: 170, direction: 'gte' }
   */
  evaluateThreshold(value, rule, maxScore) {
    const { value: threshold, direction } = rule;

    switch (direction) {
      case 'gte': // 이상
        return value >= threshold ? maxScore : maxScore * (value / threshold);
      case 'lte': // 이하
        return value <= threshold ? maxScore : maxScore * (threshold / value);
      case 'gt': // 초과
        return value > threshold ? maxScore : maxScore * 0.5;
      case 'lt': // 미만
        return value < threshold ? maxScore : maxScore * 0.5;
      default:
        return maxScore * 0.7;
    }
  }

  /**
   * 최적값 기반 평가
   * rule: { type: 'optimal', value: 90, tolerance: 10 }
   */
  evaluateOptimal(value, rule, maxScore) {
    const { value: optimal, tolerance = 15 } = rule;
    const deviation = Math.abs(value - optimal);

    if (deviation <= tolerance) {
      // 허용 범위 내
      return maxScore;
    } else {
      // 허용 범위 초과 시 점진적 감점
      const excessDeviation = deviation - tolerance;
      const penalty = Math.min(excessDeviation * 2, maxScore);
      return Math.max(0, Math.round(maxScore - penalty));
    }
  }

  /**
   * 피드백 메시지 생성 (DB rule의 feedback_low/feedback_high 우선 사용)
   */
  generateFeedback(metricKey, value, rule) {
    // DB에서 정의한 피드백이 있으면 우선 사용
    if (rule) {
      const idealMin = rule.ideal_min ?? 90;
      const idealMax = rule.ideal_max ?? 90;
      const midPoint = (idealMin + idealMax) / 2;

      if (value < idealMin && rule.feedback_low) {
        return rule.feedback_low;
      }
      if (value > idealMax && rule.feedback_high) {
        return rule.feedback_high;
      }
      // 대칭 타입의 경우
      if (rule.feedback) {
        return rule.feedback;
      }
    }

    // 기본 피드백 템플릿
    const feedbackTemplates = {
      'knee_angle': {
        low: '무릎을 더 굽혀주세요',
        high: '무릎을 조금 펴주세요'
      },
      'knee_depth': {
        low: '더 깊이 앉아주세요',
        high: '너무 깊습니다, 조금만 일어나세요'
      },
      'hip_angle': {
        low: '상체를 너무 숙였습니다. 가슴을 세워주세요',
        high: '엉덩이를 더 뒤로 빼며 앉아주세요'
      },
      'spine_angle': {
        low: '등을 더 곧게 펴주세요',
        high: '상체가 너무 기울어졌어요'
      },
      'torso_angle': {
        low: '상체를 세워주세요',
        high: '상체가 너무 기울어졌어요'
      },
      'elbow_angle': {
        low: '팔을 더 굽혀주세요',
        high: '팔을 조금 펴주세요'
      },
      'elbow_support_angle': {
        low: '팔꿈치가 몸 아래로 너무 접히지 않게 전완과 상완 각도를 조금 더 여유 있게 유지해주세요',
        high: '좋은 전완 지지 각도입니다'
      },
      'shoulder_angle': {
        low: '팔을 더 올려주세요',
        high: '팔을 조금 내려주세요'
      },
      'knee_symmetry': {
        default: '양쪽 무릎 각도를 맞춰주세요'
      },
      'elbow_symmetry': {
        default: '양팔 각도를 맞춰주세요'
      },
      'shoulder_symmetry': {
        default: '양어깨 높이를 맞춰주세요'
      },
      'knee_alignment': {
        default: '무릎이 발끝 방향을 향하도록 해주세요'
      },
      'knee_over_toe': {
        default: '무릎이 발끝을 넘지 않도록 주의하세요'
      }
    };

    const template = feedbackTemplates[metricKey];
    if (!template) {
      return '자세를 확인해주세요';
    }

    if (template.default) {
      return template.default;
    }

    // 값과 규칙을 비교해서 적절한 피드백 선택
    const idealMin = rule?.ideal_min ?? 90;
    return value < idealMin ? template.low : template.high;
  }

  scoreRep(repRecord) {
    const repContext = this.selectedView && !repRecord?.selectedView
      ? { ...repRecord, selectedView: this.selectedView }
      : repRecord;

    if (this.exerciseModule?.scoreRep) {
      return this.exerciseModule.scoreRep(this, repContext);
    }

    return repContext;
  }

  getProfileMetricConfig(metricKey, fallbackTitle, fallbackMaxScore = 100) {
    const matched = this.metrics.find((pm) => pm?.metric?.key === metricKey);
    return {
      metric_id: matched?.metric?.metric_id || null,
      title: matched?.metric?.title || fallbackTitle || metricKey,
      maxScore: matched?.max_score || fallbackMaxScore
    };
  }

  pickMetric(summary, phases, metricKey, statKey) {
    const phaseValue = this.pickPhaseMetric(summary, phases, metricKey, statKey);
    if (Number.isFinite(phaseValue)) {
      return phaseValue;
    }

    const fallback = summary?.overall?.metrics?.[metricKey]?.[statKey];
    return Number.isFinite(fallback) ? fallback : null;
  }

  pickPhaseMetric(summary, phases, metricKey, statKey) {
    for (const phase of phases) {
      const value = summary?.phases?.[phase]?.metrics?.[metricKey]?.[statKey];
      if (Number.isFinite(value)) {
        return value;
      }
    }

    return null;
  }

  interpolate(value, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMax;
    const ratio = (value - inMin) / (inMax - inMin);
    return outMin + ((outMax - outMin) * ratio);
  }

  /**
   * 평균 점수 계산
   */
  getAverageScore() {
    if (this.scoreHistory.length === 0) return 0;
    const sum = this.scoreHistory.reduce((a, b) => a + b, 0);
    return Math.round(sum / this.scoreHistory.length);
  }

  /**
   * 세션 종료 시 최종 결과 생성
   * DB의 session_metric_result에 저장할 데이터 형식
   */
  generateSessionResults() {
    // 각 메트릭별 평균 점수 계산을 위한 누적 데이터가 필요
    // 이 메서드는 WorkoutSession에서 호출됨
    return {
      final_score: this.getAverageScore(),
      metric_results: this.metrics.map(pm => ({
        metric_id: pm.metric.metric_id,
        score: Math.round(this.getAverageScore() * (pm.weight || 1)),
        raw: null // 원시 데이터는 별도 저장
      }))
    };
  }

  /**
   * 리셋
   */
  reset() {
    this.scoreHistory = [];
  }
}

// ── Quality Gate Thresholds (Appendix A seed values) ──
const QUALITY_GATE_THRESHOLDS = {
  detectionConfidence: 0.50,
  trackingConfidence: 0.50,
  estimatedViewConfidence: 0.60,
  keyJointVisibilityAverage: 0.65,
  minKeyJointVisibility: 0.40,
  stableFrameCount: 8,
  stabilityWindow: 12,
  unstableFrameRatio: 0.30,
  frameInclusionRatio: 0.85,
};

/**
 * Evaluate whether the current frame input quality is sufficient for scoring.
 * Returns { result: 'pass' | 'withhold', reason: string | null }
 *
 * Input quality failures are NEVER delegated to exercise modules.
 * Only pass → exercise module evaluation runs.
 */
function evaluateQualityGate(inputs, context) {
  if (!inputs.cameraDistanceOk) {
    return { result: 'withhold', reason: 'camera_too_close_or_far' };
  }
  if (inputs.detectionConfidence < QUALITY_GATE_THRESHOLDS.detectionConfidence) {
    return { result: 'withhold', reason: 'low_detection_confidence' };
  }
  if (inputs.trackingConfidence < QUALITY_GATE_THRESHOLDS.trackingConfidence) {
    return { result: 'withhold', reason: 'low_tracking_confidence' };
  }
  if (inputs.frameInclusionRatio < QUALITY_GATE_THRESHOLDS.frameInclusionRatio) {
    return { result: 'withhold', reason: 'body_not_fully_visible' };
  }
  if (inputs.minKeyJointVisibility < QUALITY_GATE_THRESHOLDS.minKeyJointVisibility ||
      inputs.keyJointVisibilityAverage < QUALITY_GATE_THRESHOLDS.keyJointVisibilityAverage) {
    return { result: 'withhold', reason: 'key_joints_not_visible' };
  }
  if ((context && context.allowedViews || []).length > 0) {
    const viewAllowed = context.allowedViews.includes(inputs.estimatedView);
    if (!viewAllowed || inputs.estimatedViewConfidence < QUALITY_GATE_THRESHOLDS.estimatedViewConfidence) {
      return { result: 'withhold', reason: 'view_mismatch' };
    }
  }
  if (inputs.unstableFrameRatio >= QUALITY_GATE_THRESHOLDS.unstableFrameRatio) {
    return { result: 'withhold', reason: 'unstable_tracking' };
  }
  if (inputs.stableFrameCount < QUALITY_GATE_THRESHOLDS.stableFrameCount) {
    return { result: 'withhold', reason: 'insufficient_stable_frames' };
  }
  return { result: 'pass', reason: null };
}

/**
 * Apply rep outcome state transitions based on gate result and exercise evaluation.
 *
 * Spec §7.2:
 *   - withhold → rep discarded, no rep count increment
 *   - hard_fail → rep recorded as hard_fail, no count increment, score cap 0
 *   - soft_fail → rep recorded as soft_fail, count incremented, score cap applied
 *   - scored → normal rep, count incremented
 */
function applyRepOutcome({ gateResult, repState, exerciseEvaluation }) {
  if (gateResult === 'withhold') {
    return {
      repResult: 'withheld',
      incrementRepCount: false,
      discardActiveRep: Boolean(repState && repState.active),
      scoreCapApplied: null,
    };
  }

  // gateResult is 'pass' — evaluate exercise result
  if (exerciseEvaluation && exerciseEvaluation.hardFailReason) {
    return {
      repResult: 'hard_fail',
      incrementRepCount: false,
      discardActiveRep: true,
      scoreCapApplied: 0,
    };
  }

  if (exerciseEvaluation && exerciseEvaluation.softFailReasons && exerciseEvaluation.softFailReasons.length > 0) {
    return {
      repResult: 'soft_fail',
      incrementRepCount: true,
      discardActiveRep: false,
      scoreCapApplied: exerciseEvaluation.scoreCap || null,
    };
  }

  return {
    repResult: 'scored',
    incrementRepCount: true,
    discardActiveRep: false,
    scoreCapApplied: null,
  };
}

// 전역 접근 가능하도록 export
if (typeof window !== 'undefined') {
  window.ScoringEngine = ScoringEngine;
  window.QUALITY_GATE_THRESHOLDS = QUALITY_GATE_THRESHOLDS;
  window.evaluateQualityGate = evaluateQualityGate;
  window.applyRepOutcome = applyRepOutcome;
}

// CommonJS test exports
if (typeof module !== 'undefined') {
  module.exports = {
    ScoringEngine,
    QUALITY_GATE_THRESHOLDS,
    evaluateQualityGate,
    applyRepOutcome,
  };
}
