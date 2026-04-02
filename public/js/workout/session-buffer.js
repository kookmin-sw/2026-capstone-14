/**
 * FitPlus Session Buffer - 세션 데이터 로컬 버퍼링
 * 운동 종료 시 서버로 배치 전송
 */

class SessionBuffer {
  constructor(sessionId) {
    this.sessionId = sessionId;
    this.startTime = Date.now();
    
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
    
    // IndexedDB 키
    this.dbKey = `fitplus_session_${sessionId}`;
    
    console.log('[SessionBuffer] 초기화:', sessionId);
  }

  /**
   * 점수 데이터 추가 (1초당 1개 다운샘플링)
   */
  addScore(scoreResult) {
    const now = Date.now();
    
    // 1초 간격으로 샘플링
    if (now - this.lastScoreTime >= 1000) {
      this.scoreTimeline.push({
        score: scoreResult.score,
        timestamp: now - this.startTime, // 상대 시간 (ms)
        breakdown: scoreResult.breakdown?.map(b => ({
          key: b.key,
          score: b.score
        }))
      });
      this.lastScoreTime = now;
      
      // 메트릭별 누적
      if (scoreResult.breakdown) {
        for (const item of scoreResult.breakdown) {
          if (!this.metricAccumulators[item.key]) {
            this.metricAccumulators[item.key] = {
              metric_id: item.metric_id,
              scores: [],
              rawValues: [],
              feedbackCount: 0
            };
          }
          this.metricAccumulators[item.key].scores.push(item.score);
          // 원본 각도값 누적
          if (item.actualValue != null && Number.isFinite(item.actualValue)) {
            this.metricAccumulators[item.key].rawValues.push(item.actualValue);
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
  addEvent(type, payload = {}) {
    this.events.push({
      type,
      payload,
      timestamp: Date.now() - this.startTime
    });
  }

  /**
   * 로컬 스토리지에 백업 저장
   */
  saveToStorage() {
    try {
      const data = {
        sessionId: this.sessionId,
        startTime: this.startTime,
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
   * DB의 session_metric_result 테이블용
   */
  generateMetricResults() {
    const results = [];
    const source = Object.keys(this.repMetricAccumulators).length > 0
      ? this.repMetricAccumulators
      : this.metricAccumulators;
    
    for (const [key, data] of Object.entries(source)) {
      if (data.scores.length > 0) {
        const avgScore = Math.round(
          data.scores.reduce((a, b) => a + b, 0) / data.scores.length
        );
        
        // 원본 각도값 평균 계산
        let avgRaw = null;
        if (data.rawValues && data.rawValues.length > 0) {
          avgRaw = Math.round(
            data.rawValues.reduce((a, b) => a + b, 0) / data.rawValues.length
          );
        }
        
        results.push({
          metric_id: data.metric_id,
          score: avgScore,
          raw: avgRaw
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
        scores: [],
        rawValues: [],
        feedbackCount: 0
      };
    }

    if (Number.isFinite(item.score)) {
      target[key].scores.push(item.score);
    }
    if (Number.isFinite(item.rawValue)) {
      target[key].rawValues.push(item.rawValue);
    }
    if (item.feedback) {
      target[key].feedbackCount++;
    }
  }

  /**
   * 서버 전송용 데이터 생성
   */
  export() {
    const finalScore = this.calculateFinalScore();
    
    // 세트 기록이 없으면 기본 1세트 생성
    const setRecords = this.setRecords.length > 0 ? this.setRecords : [{
      set_no: 1,
      phase: 'WORK',
      actual_reps: this.getTotalReps(),
      duration_sec: this.getDuration()
    }];
    
    return {
      // 기본 세션 정보
      duration_sec: this.getDuration(),
      total_reps: this.getTotalReps(),
      final_score: finalScore,
      summary_feedback: this.generateSummaryFeedback(finalScore),
      
      // 상세 데이터 (detail JSON)
      detail: {
        score_timeline: this.scoreTimeline,
        rep_records: this.repRecords,
        set_records: setRecords,
        events: this.events,
        stats: {
          avg_rep_score: this.calculateAvgRepScore(),
          best_rep: this.getBestRep(),
          total_sets: setRecords.length
        }
      },
      
      // 별도 테이블용 데이터 (서버에서 처리)
      metric_results: this.generateMetricResults(),
      set_records: setRecords,
      events: this.events
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
  generateSummaryFeedback(score) {
    const reps = this.getTotalReps();
    const duration = this.getDuration();
    
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
    if (reps > 0) {
      feedback += ` ${reps}회 완료!`;
    }
    
    return feedback;
  }
}

// 전역 접근 가능하도록 export
window.SessionBuffer = SessionBuffer;
