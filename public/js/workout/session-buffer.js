/**
 * FitPlus Session Buffer - 세션 데이터 로컬 버퍼링
 * 운동 종료 시 서버로 배치 전송
 */

class SessionBuffer {
  constructor(sessionId, options = {}) {
    this.sessionId = sessionId;
    this.startTime = Date.now();
    this.exerciseCode = (options.exerciseCode || '').toString().trim().toLowerCase();
    this.mode = (options.mode || 'FREE').toString().trim().toUpperCase();
    this.selectedView = this.normalizeViewCode(options.selectedView);
    this.resultBasisHint = this.normalizeResultBasis(options.resultBasis);
    this.targetSec = this.normalizePositiveInt(options.targetSec);

    // 점수 타임라인 (1초당 1개 샘플링)
    this.scoreTimeline = [];
    this.lastScoreTime = 0;

    // 횟수 기록
    this.repRecords = [];

    // 세트 기록
    this.setRecords = [];
    this.currentSetNumber = 1;
    this.currentSetReps = 0;
    this.currentSetStartTime = Date.now();

    // 메트릭별 누적 데이터
    this.metricAccumulators = {};
    this.repMetricAccumulators = {};

    // 이벤트 로그
    this.events = [];

    // Rep 평가 결과 (scored|hard_fail|soft_fail|withheld)
    this.repResults = [];

    // IndexedDB 키
    this.dbKey = `fitplus_session_${sessionId}`;

    console.log('[SessionBuffer] 초기화:', sessionId);
  }

  normalizeViewCode(view) {
    const normalized = (view || '').toString().trim().toUpperCase();
    return ['FRONT', 'SIDE', 'DIAGONAL'].includes(normalized) ? normalized : null;
  }

  normalizeResultBasis(resultBasis) {
    const normalized = (resultBasis || '').toString().trim().toUpperCase();
    return ['REPS', 'DURATION'].includes(normalized) ? normalized : null;
  }

  normalizePositiveInt(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.round(parsed);
  }

  normalizeNonNegativeInt(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.round(parsed);
  }

  clampMetricScore(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.min(100, parsed));
  }

  getNormalizedMetricScore(item) {
    const explicit = item?.normalizedScore ?? item?.normalized_score;
    const explicitScore = this.clampMetricScore(explicit);
    if (explicitScore != null) return explicitScore;

    const rawScore = Number(item?.score);
    const rawMaxScore = Number(item?.maxScore ?? item?.max_score);
    if (Number.isFinite(rawScore) && Number.isFinite(rawMaxScore) && rawMaxScore > 0) {
      return this.clampMetricScore((rawScore / rawMaxScore) * 100);
    }

    return this.clampMetricScore(item?.avg_score);
  }

  /**
   * 점수 데이터 추가 (1초당 1개 다운샘플링)
   */
  addScore(scoreResult) {
    const now = Date.now();

    // 1초 간격으로 샘플링
    if (now - this.lastScoreTime >= 1000) {
      const sampledBreakdown = (scoreResult.breakdown || []).map((item) => ({
        key: item.key,
        title: item.title || item.key,
        score: Number.isFinite(item.score) ? item.score : null,
        normalizedScore: this.getNormalizedMetricScore(item),
        maxScore: Number.isFinite(item.maxScore) ? item.maxScore : null,
        rawValue: Number.isFinite(item.rawValue) ? item.rawValue : (
          Number.isFinite(item.actualValue) ? item.actualValue : null
        ),
        weight: Number.isFinite(item.weight) ? item.weight : null,
        feedback: item.feedback || null
      }));

      this.scoreTimeline.push({
        score: scoreResult.score,
        timestamp: now - this.startTime, // 상대 시간 (ms)
        breakdown: sampledBreakdown
      });
      this.lastScoreTime = now;

      // 메트릭별 누적
      if (scoreResult.breakdown) {
        for (const item of scoreResult.breakdown) {
          if (!item?.key) continue;
          if (!this.metricAccumulators[item.key]) {
            this.metricAccumulators[item.key] = {
              metric_id: item.metric_id,
              title: item.title || item.key,
              maxScore: 100,
              scores: [],
              rawValues: [],
              feedbackCount: 0
            };
          }
          this.metricAccumulators[item.key].title = item.title || this.metricAccumulators[item.key].title || item.key;
          const normalizedScore = this.getNormalizedMetricScore(item);
          if (normalizedScore != null) {
            this.metricAccumulators[item.key].scores.push(normalizedScore);
          }
          // 원본 각도값 누적
          const rawValue = Number.isFinite(item.rawValue)
            ? item.rawValue
            : (Number.isFinite(item.actualValue) ? item.actualValue : null);
          if (rawValue != null) {
            this.metricAccumulators[item.key].rawValues.push(rawValue);
          }
          if (item.feedback) {
            this.metricAccumulators[item.key].feedbackCount++;
          }
        }
      }

      // 주기적 백업
      if (this.scoreTimeline.length % 30 === 0) {
        this.saveToStorage();
      }
    }
  }

  /**
   * 횟수 기록 추가
   */
  addRep(repRecord) {
    this.repRecords.push({
      ...repRecord,
      setNumber: this.currentSetNumber,
      relativeTime: Date.now() - this.startTime
    });

    if (Array.isArray(repRecord.breakdown)) {
      for (const item of repRecord.breakdown) {
        this.accumulateMetric(this.repMetricAccumulators, item);
      }
    }

    this.currentSetReps++;

    console.log(`[SessionBuffer] 횟수 기록: ${repRecord.repNumber}회`);
  }

  /**
   * 세트 완료
   */
  completeSet(restSeconds = 0) {
    const setRecord = {
      set_no: this.currentSetNumber,
      phase: 'WORK',
      actual_reps: this.currentSetReps,
      duration_sec: Math.round((Date.now() - this.currentSetStartTime) / 1000),
      rest_sec: restSeconds
    };

    this.setRecords.push(setRecord);
    this.addEvent('SET_RECORD');

    // 다음 세트 준비
    this.currentSetNumber++;
    this.currentSetReps = 0;
    this.currentSetStartTime = Date.now();

    console.log(`[SessionBuffer] 세트 완료:`, setRecord);

    return setRecord;
  }

  /**
   * 이벤트 기록
   */
  addEvent(type) {
    this.events.push({
      type,
      timestamp: Date.now() - this.startTime
    });
  }

  /**
   * 구조화된 이벤트 기록 (withhold, gate 판정 등)
   * 기존 addEvent(type)는 하위 호환 유지
   */
  recordEvent(event) {
    this.events.push({ ...event });
  }

  /**
   * Rep 평가 결과 기록 (scored|hard_fail|soft_fail|withheld)
   */
  recordRepResult(repResult) {
    this.repResults.push({ ...repResult });
  }

  /**
   * 로컬 스토리지에 백업 저장
   */
  saveToStorage() {
    try {
      const data = {
        sessionId: this.sessionId,
        startTime: this.startTime,
        exerciseCode: this.exerciseCode,
        mode: this.mode,
        selectedView: this.selectedView,
        resultBasisHint: this.resultBasisHint,
        scoreTimeline: this.scoreTimeline,
        repRecords: this.repRecords,
        repMetricAccumulators: this.repMetricAccumulators,
        setRecords: this.setRecords,
        events: this.events,
        savedAt: Date.now()
      };

      localStorage.setItem(this.dbKey, JSON.stringify(data));
    } catch (error) {
      console.warn('[SessionBuffer] 저장 실패:', error);
    }
  }

  /**
   * 로컬 스토리지에서 복구
   */
  loadFromStorage() {
    try {
      const data = localStorage.getItem(this.dbKey);
      if (data) {
        const parsed = JSON.parse(data);
        this.scoreTimeline = parsed.scoreTimeline || [];
        this.repRecords = parsed.repRecords || [];
        this.repMetricAccumulators = parsed.repMetricAccumulators || {};
        this.setRecords = parsed.setRecords || [];
        this.events = parsed.events || [];
        this.exerciseCode = parsed.exerciseCode || this.exerciseCode;
        this.mode = parsed.mode || this.mode;
        this.selectedView = this.normalizeViewCode(parsed.selectedView) || this.selectedView;
        this.resultBasisHint = this.normalizeResultBasis(parsed.resultBasisHint) || this.resultBasisHint;
        console.log('[SessionBuffer] 데이터 복구됨');
        return true;
      }
    } catch (error) {
      console.warn('[SessionBuffer] 복구 실패:', error);
    }
    return false;
  }

  /**
   * 로컬 스토리지에서 삭제
   */
  clearStorage() {
    try {
      localStorage.removeItem(this.dbKey);
    } catch (error) {
      console.warn('[SessionBuffer] 삭제 실패:', error);
    }
  }

  /**
   * 최종 점수 계산
   */
  calculateFinalScore() {
    // rep 기반 운동은 rep 점수 평균을 우선 사용 (스쿼트처럼 중립 구간에서 점수가 떨어지는 문제 방지)
    if (this.repRecords.length > 0) {
      return this.calculateAvgRepScore();
    }

    if (this.scoreTimeline.length === 0) return 0;

    const scores = this.scoreTimeline.map(s => s.score);
    const sum = scores.reduce((a, b) => a + b, 0);
    return Math.round(sum / scores.length);
  }

  /**
   * 총 횟수 계산
   */
  getTotalReps() {
    return this.repRecords.length;
  }

  /**
   * 총 운동 시간 (초)
   */
  getDuration() {
    return Math.round((Date.now() - this.startTime) / 1000);
  }

  /**
   * 메트릭별 결과 생성
   * DB의 session_snapshot_metric(FINAL) 저장용
   */
  generateMetricResults() {
    const results = [];
    const source = Object.keys(this.repMetricAccumulators).length > 0
      ? this.repMetricAccumulators
      : this.metricAccumulators;

    for (const [key, data] of Object.entries(source)) {
      if (data.scores.length > 0) {
        const scoreSum = data.scores.reduce((a, b) => a + b, 0);
        const avgScore = Math.round((scoreSum / data.scores.length) * 100) / 100;
        const rawValues = Array.isArray(data.rawValues) ? data.rawValues : [];
        const avgRaw = rawValues.length > 0
          ? Math.round((rawValues.reduce((a, b) => a + b, 0) / rawValues.length) * 100) / 100
          : null;
        const minRaw = rawValues.length > 0 ? Math.min(...rawValues) : null;
        const maxRaw = rawValues.length > 0 ? Math.max(...rawValues) : null;

        results.push({
          metric_key: key,
          metric_name: data.title || key,
          avg_score: avgScore,
          avg_raw_value: avgRaw,
          min_raw_value: minRaw,
          max_raw_value: maxRaw,
          sample_count: data.scores.length
        });
      }
    }

    return results;
  }

  accumulateMetric(target, item) {
    const key = item?.key;
    if (!key) return;

    if (!target[key]) {
      target[key] = {
        metric_id: item.metric_id,
        title: item.title || key,
        maxScore: 100,
        scores: [],
        rawValues: [],
        feedbackCount: 0
      };
    }

    target[key].title = item.title || target[key].title || key;
    const normalizedScore = this.getNormalizedMetricScore(item);
    if (normalizedScore != null) {
      target[key].scores.push(normalizedScore);
    }
    const rawValue = Number.isFinite(item.rawValue)
      ? item.rawValue
      : (Number.isFinite(item.actualValue) ? item.actualValue : null);
    if (rawValue != null) {
      target[key].rawValues.push(rawValue);
    }
    if (item.feedback) {
      target[key].feedbackCount++;
    }
  }

  /**
   * 서버 전송용 데이터 생성
   */
  getResultPayload() {
    const durationSec = this.getDuration();
    const totalReps = this.getTotalReps();
    let resultBasis = this.resultBasisHint;

    if (!resultBasis) {
      resultBasis = totalReps > 0 ? 'REPS' : 'DURATION';
    }

    const totalResultValue = resultBasis === 'REPS' ? totalReps : durationSec;
    const totalResultUnit = resultBasis === 'REPS' ? 'COUNT' : 'SEC';

    return {
      result_basis: resultBasis,
      total_result_value: totalResultValue,
      total_result_unit: totalResultUnit,
      duration_sec: durationSec,
      total_reps: totalReps
    };
  }

  calculateTimeScore(bestHoldSec, targetSec) {
    const best = this.normalizePositiveInt(bestHoldSec) || 0;
    const target = this.normalizePositiveInt(targetSec) || 0;
    if (target <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((best / target) * 100)));
  }

  normalizeInterimBreakdown(breakdown) {
    if (!Array.isArray(breakdown) || breakdown.length === 0) return [];

    return breakdown
      .map((item) => {
        const metricKey = (item?.key || item?.metric_key || '').toString().trim();
        if (!metricKey) return null;

        const score = this.getNormalizedMetricScore(item);
        const rawValue = Number.isFinite(item?.rawValue)
          ? item.rawValue
          : (Number.isFinite(item?.actualValue) ? item.actualValue : item?.avg_raw_value);

        return {
          metric_key: metricKey,
          metric_name: item?.title || item?.metric_name || metricKey,
          avg_score: score,
          avg_raw_value: Number.isFinite(rawValue) ? rawValue : null,
          min_raw_value: Number.isFinite(item?.minRaw) ? item.minRaw : (Number.isFinite(rawValue) ? rawValue : null),
          max_raw_value: Number.isFinite(item?.maxRaw) ? item.maxRaw : (Number.isFinite(rawValue) ? rawValue : null),
          sample_count: Number.isFinite(item?.sampleCount) ? Math.max(0, Math.round(item.sampleCount)) : 1
        };
      })
      .filter(Boolean);
  }

  generateInterimSnapshots() {
    return this.scoreTimeline.map((item) => ({
      timestamp_ms: item.timestamp,
      score: item.score,
      breakdown: this.normalizeInterimBreakdown(item.breakdown)
    }));
  }

  export(options = {}) {
    const isTimeBased = options.isTimeBased === true || this.resultBasisHint === 'DURATION';
    const bestHoldSec = this.normalizePositiveInt(options.bestHoldSec) || 0;
    const targetSec = this.normalizePositiveInt(options.targetSec) || this.targetSec || 0;
    const normalizedPostureScore = this.normalizeNonNegativeInt(options.bestHoldPostureScore);
    const postureScore = normalizedPostureScore != null ? normalizedPostureScore : this.calculateFinalScore();
    const timeScore = isTimeBased ? this.calculateTimeScore(bestHoldSec, targetSec) : 0;
    const finalScore = isTimeBased
      ? Math.max(0, Math.min(100, Math.round((postureScore * 0.8) + (timeScore * 0.2))))
      : this.calculateFinalScore();
    const resultPayload = isTimeBased
      ? {
          result_basis: 'DURATION',
          total_result_value: bestHoldSec,
          total_result_unit: 'SEC',
          duration_sec: this.getDuration(),
          total_reps: 0
        }
      : this.getResultPayload();

    const interimSnapshots = this.generateInterimSnapshots();

    // MVP export: withhold 이벤트 집계
    const withholdEvents = (this.events || []).filter((event) => event.type === 'withhold');
    const withholdReasonCounts = withholdEvents.reduce((acc, event) => {
      const reason = event.withhold_reason || 'unknown';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {});

    return {
      // 기본 세션 정보
      selected_view: this.selectedView,
      target_sec: targetSec || null,
      best_hold_sec: isTimeBased ? bestHoldSec : null,
      posture_score: postureScore,
      time_score: isTimeBased ? timeScore : null,
      ...resultPayload,
      final_score: finalScore,
      summary_feedback: this.generateSummaryFeedback(finalScore, {
        isTimeBased,
        bestHoldSec,
        targetSec,
        postureScore,
        timeScore
      }),

      // 별도 테이블용 데이터 (서버에서 처리)
      metric_results: this.generateMetricResults(),
      interim_snapshots: interimSnapshots,
      events: this.events,

      // MVP export: withhold 및 rep 결과 필드
      withhold_count: withholdEvents.length,
      withhold_reason_counts: withholdReasonCounts,
      rep_results: this.repResults || []
    };
  }

  /**
   * 평균 횟수당 점수
   */
  calculateAvgRepScore() {
    if (this.repRecords.length === 0) return 0;
    const sum = this.repRecords.reduce((a, r) => a + (r.score || 0), 0);
    return Math.round(sum / this.repRecords.length);
  }

  /**
   * 최고 점수 횟수
   */
  getBestRep() {
    if (this.repRecords.length === 0) return null;
    return this.repRecords.reduce((best, r) =>
      (r.score || 0) > (best.score || 0) ? r : best
    , this.repRecords[0]);
  }

  /**
   * 요약 피드백 생성
   */
  generateSummaryFeedback(score, options = {}) {
    const reps = this.getTotalReps();
    const duration = this.getDuration();
    const isTimeBased = options.isTimeBased === true;
    const bestHoldSec = this.normalizePositiveInt(options.bestHoldSec) || 0;
    const targetSec = this.normalizePositiveInt(options.targetSec) || 0;

    let feedback = '';

    // 점수 기반 피드백
    if (score >= 90) {
      feedback = '완벽해요! 훌륭한 자세로 운동했습니다. 💪';
    } else if (score >= 80) {
      feedback = '잘했어요! 자세가 매우 좋습니다. 👍';
    } else if (score >= 70) {
      feedback = '좋아요! 조금만 더 신경쓰면 완벽해요.';
    } else if (score >= 60) {
      feedback = '나쁘지 않아요. 자세에 조금 더 집중해보세요.';
    } else {
      feedback = '자세 교정이 필요합니다. 운동 가이드를 참고해보세요.';
    }

    // 추가 정보
    if (isTimeBased) {
      if (bestHoldSec > 0 && targetSec > 0) {
        feedback += ` 최고 ${bestHoldSec}초 유지, 목표 ${targetSec}초 기준입니다.`;
      } else if (duration > 0) {
        feedback += ` 총 ${duration}초 동안 자세를 유지했습니다.`;
      }
      return feedback;
    }

    if (reps > 0) {
      feedback += ` ${reps}회 완료!`;
    }

    return feedback;
  }
}

// 전역 접근 가능하도록 export
window.SessionBuffer = SessionBuffer;
