/**
 * 푸쉬업 전용 rep 추적/채점/품질 게이트
 */
(function registerPushUpExerciseModule() {
  const registry = window.WorkoutExerciseRegistry;
  if (!registry) return;

  const REP_PHASES = {
    NEUTRAL: 'NEUTRAL',
    DESCENT: 'DESCENT',
    BOTTOM: 'BOTTOM',
    ASCENT: 'ASCENT',
    LOCKOUT: 'LOCKOUT'
  };
  const SCORING_PHASES = [REP_PHASES.DESCENT, REP_PHASES.BOTTOM, REP_PHASES.ASCENT, REP_PHASES.LOCKOUT];

  const pushUpExercise = {
    code: 'push_up',

    getDefaultProfileMetrics() {
      return [
        {
          weight: 0.35,
          max_score: 35,
          rule: {
            ideal_min: 70,
            ideal_max: 100,
            acceptable_min: 55,
            acceptable_max: 120,
            feedback_high: '가슴을 조금 더 내려주세요'
          },
          metric: {
            metric_id: 'pushup_depth',
            key: 'elbow_depth',
            title: '푸쉬업 깊이',
            unit: 'DEG'
          }
        },
        {
          weight: 0.25,
          max_score: 25,
          rule: {
            ideal_min: 150,
            ideal_max: 180,
            acceptable_min: 135,
            acceptable_max: 180,
            feedback_low: '올라올 때 팔을 끝까지 펴주세요'
          },
          metric: {
            metric_id: 'pushup_lockout',
            key: 'elbow_lockout',
            title: '팔 펴기',
            unit: 'DEG'
          }
        },
        {
          weight: 0.25,
          max_score: 25,
          rule: {
            ideal_min: 155,
            ideal_max: 180,
            acceptable_min: 140,
            acceptable_max: 180,
            feedback_low: '엉덩이가 처지지 않게 몸을 일직선으로 유지해주세요'
          },
          metric: {
            metric_id: 'pushup_body_line',
            key: 'hip_angle',
            title: '몸통 일직선',
            unit: 'DEG'
          }
        },
        {
          weight: 0.15,
          max_score: 15,
          rule: {
            ideal_min: 55,
            ideal_max: 105,
            acceptable_min: 35,
            acceptable_max: 125,
            feedback_low: '머리부터 골반까지 같은 각도로 움직여주세요',
            feedback_high: '머리부터 골반까지 같은 각도로 움직여주세요'
          },
          metric: {
            metric_id: 'pushup_torso_angle',
            key: 'spine_angle',
            title: '상체 각도',
            unit: 'DEG'
          }
        },
        {
          weight: 0.1,
          max_score: 10,
          rule: { type: 'hold' },
          metric: {
            metric_id: 'pushup_torso_stability',
            key: 'spine_stability',
            title: '상체 안정성',
            unit: 'DEG'
          }
        },
        {
          weight: 0.1,
          max_score: 10,
          rule: { type: 'tempo' },
          metric: {
            metric_id: 'pushup_tempo',
            key: 'tempo',
            title: '동작 템포',
            unit: 'MS'
          }
        }
      ];
    },

    getRepPattern() {
      return {
        primaryAngle: 'elbow_angle',
        thresholds: {
          neutral: 155,
          active: 95
        },
        direction: 'decrease',
        minDuration: 700,
        minActiveTime: 180
      };
    },

    getFrameGate(angles, runtime) {
      const quality = angles?.quality || {};
      const view = angles?.view || 'UNKNOWN';
      const selectedView = runtime?.selectedView || runtime?.state?.selectedView || null;
      const trackedJointRatio = quality.trackedJointRatio ?? 0;
      const inFrameRatio = quality.inFrameRatio ?? 0;
      const score = quality.score ?? 0;
      const viewStability = quality.viewStability ?? 0;
      const elbowAngle = runtime?.repCounter?.getAngleValue ? runtime.repCounter.getAngleValue(angles, 'elbow_angle') : null;
      const hipAngle = runtime?.repCounter?.getAngleValue ? runtime.repCounter.getAngleValue(angles, 'hip_angle') : null;
      const spineAngle = runtime?.repCounter?.getAngleValue ? runtime.repCounter.getAngleValue(angles, 'spine_angle') : null;

      if (!Number.isFinite(elbowAngle) || !Number.isFinite(hipAngle) || !Number.isFinite(spineAngle)) {
        return {
          isReady: false,
          reason: 'joints_missing',
          message: '어깨부터 손목, 골반과 하체까지 전신이 보이도록 카메라를 맞춰주세요'
        };
      }

      if (trackedJointRatio < 0.65) {
        return {
          isReady: false,
          reason: 'tracked_joints_low',
          message: '팔과 하체가 모두 보이도록 카메라를 조금 더 멀리 두세요'
        };
      }

      if (inFrameRatio < 0.7) {
        return {
          isReady: false,
          reason: 'out_of_frame',
          message: '머리부터 발끝까지 프레임 안에 들어오도록 위치를 조정해주세요'
        };
      }

      if (view === 'UNKNOWN') {
        return {
          isReady: false,
          reason: 'view_unknown',
          message: '몸을 측면으로 돌려 푸쉬업 자세를 잡아주세요'
        };
      }

      if (selectedView && view !== selectedView) {
        return {
          isReady: false,
          reason: 'view_mismatch',
          message: '푸쉬업은 측면 자세에서만 채점합니다. 몸을 옆으로 돌려주세요'
        };
      }

      if (viewStability < 0.55) {
        return {
          isReady: false,
          reason: 'view_unstable',
          message: '몸 방향이 흔들리고 있습니다. 측면 자세를 유지해주세요'
        };
      }

      if (score < 0.45) {
        return {
          isReady: false,
          reason: 'quality_low',
          message: '카메라 위치와 조명을 조정한 뒤 다시 자세를 잡아주세요'
        };
      }

      return { isReady: true };
    },

    startRepTracking(repCounter, now) {
      repCounter.currentPhase = REP_PHASES.NEUTRAL;
      repCounter.currentRepSummary = createRepSummary(repCounter, now);
      repCounter.repLastFrameTime = now;
      repCounter.bottomStableFrames = 0;
      repCounter.bottomReached = false;
      repCounter.ascentStarted = false;
    },

    resetRepTracking(repCounter) {
      repCounter.currentPhase = REP_PHASES.NEUTRAL;
      repCounter.currentRepSummary = null;
      repCounter.repLastFrameTime = null;
      repCounter.bottomStableFrames = 0;
      repCounter.bottomReached = false;
      repCounter.ascentStarted = false;
    },

    updateRepTracking(repCounter, angles, now, primaryAngle, currentScore) {
      if (!repCounter.currentRepSummary) {
        this.startRepTracking(repCounter, now);
      }

      const phase = detectPhase(repCounter, angles, primaryAngle);
      const deltaMs = repCounter.repLastFrameTime != null
        ? Math.max(0, Math.min(now - repCounter.repLastFrameTime, 120))
        : 0;

      repCounter.repLastFrameTime = now;
      repCounter.currentPhase = phase;

      const snapshot = getSnapshot(repCounter, angles, primaryAngle);
      recordFrame(repCounter, phase, deltaMs, snapshot);

      if (SCORING_PHASES.includes(phase) && Number.isFinite(currentScore)) {
        repCounter.currentMovementScores.push(currentScore);
      }
    },

    finalizeRepSummary(repCounter) {
      if (!repCounter.currentRepSummary) return null;

      const summary = repCounter.currentRepSummary;
      const confidenceScore = getScoringPhaseConfidence(summary);

      return {
        exerciseCode: summary.exerciseCode,
        durationMs: Math.round(summary.durationMs),
        finalPhase: summary.finalPhase,
        flags: summary.flags,
        dominantView: repCounter.getDominantBucketKey(summary.views),
        views: summary.views,
        confidence: {
          score: Math.round(confidenceScore * 100) / 100,
          level: repCounter.getConfidenceLevel(confidenceScore),
          factor: repCounter.getConfidenceFactor(confidenceScore),
          levels: summary.quality.levels
        },
        overall: finalizePhaseSummary(repCounter, summary.overall),
        phases: Object.fromEntries(
          Object.entries(summary.phases).map(([phase, phaseSummary]) => [phase, finalizePhaseSummary(repCounter, phaseSummary)])
        )
      };
    },

    scoreRep(scoringEngine, repRecord) {
      const summary = repRecord?.summary;
      if (!summary) return repRecord;

      const requestedView = repRecord?.selectedView || null;
      const view = requestedView && requestedView !== 'DIAGONAL'
        ? requestedView
        : (summary.dominantView || 'UNKNOWN');
      const confidence = summary.confidence || { score: 0, level: 'LOW', factor: 0.7 };

      const bottomElbow = scoringEngine.pickMetric(summary, ['BOTTOM', 'DESCENT'], 'elbowAngle', 'min');
      const lockoutElbow = scoringEngine.pickMetric(summary, ['LOCKOUT', 'ASCENT'], 'elbowAngle', 'max');
      const minHip = scoringEngine.pickMetric(summary, ['DESCENT', 'BOTTOM', 'ASCENT'], 'hipAngle', 'min');
      const spineRange = getMetricRange(summary, ['DESCENT', 'BOTTOM', 'ASCENT'], 'spineAngle');
      const duration = Number.isFinite(repRecord?.duration) ? repRecord.duration : summary.durationMs;

      const hardFails = [];
      if (view !== 'SIDE') {
        hardFails.push('view_mismatch');
      }
      if (!summary.flags?.bottomReached || bottomElbow == null || bottomElbow > 110) {
        hardFails.push('depth_not_reached');
      }
      if (!summary.flags?.lockoutReached || (lockoutElbow != null && lockoutElbow < 145)) {
        hardFails.push('lockout_incomplete');
      }
      if (minHip != null && minHip < 140) {
        hardFails.push('body_line_broken');
      }
      if (confidence.level === 'LOW') {
        hardFails.push('low_confidence');
      }

      const metricPlan = getMetricPlan({
        bottomElbow,
        lockoutElbow,
        minHip,
        spineRange,
        duration
      });
      const breakdown = [];
      let weightedScore = 0;
      let totalWeight = 0;

      for (const item of metricPlan) {
        const normalizedScore = item.scorer();
        if (!Number.isFinite(normalizedScore)) continue;

        const metric = scoringEngine.getProfileMetricConfig(item.key, item.title, item.maxScore);
        const score = Math.round((normalizedScore / 100) * metric.maxScore);
        breakdown.push({
          metric_id: metric.metric_id,
          key: item.key,
          title: metric.title,
          rawValue: item.rawValue(),
          score,
          maxScore: metric.maxScore,
          weight: item.weight,
          feedback: normalizedScore < 70 ? item.feedback : null
        });

        weightedScore += normalizedScore * item.weight;
        totalWeight += item.weight;
      }

      const baseScore = totalWeight > 0 ? (weightedScore / totalWeight) : (repRecord.score || 0);
      let finalScore = baseScore * (confidence.factor || 0.7);

      if (hardFails.includes('view_mismatch')) {
        finalScore = Math.min(finalScore, 50);
      }
      if (hardFails.includes('depth_not_reached')) {
        finalScore = Math.min(finalScore, 55);
      }
      if (hardFails.includes('lockout_incomplete')) {
        finalScore = Math.min(finalScore, 65);
      }
      if (hardFails.includes('body_line_broken')) {
        finalScore = Math.min(finalScore, 60);
      }
      if (hardFails.includes('low_confidence')) {
        finalScore = Math.min(finalScore, 60);
      }

      finalScore = Math.max(0, Math.min(100, Math.round(finalScore)));

      const softFails = breakdown
        .filter((item) => item.maxScore > 0 && (item.score / item.maxScore) < 0.7)
        .map((item) => item.key);

      const feedback = pickFeedback({
        hardFails,
        breakdown,
        confidence,
        minHip,
        spineRange
      });

      console.log('[ScoringEngine][PushUp] Rep evaluation:', {
        repNumber: repRecord.repNumber,
        scoreBeforeRepScoring: repRecord.score,
        finalScore,
        view,
        confidenceLevel: confidence.level,
        confidenceScore: confidence.score,
        bottomElbow,
        lockoutElbow,
        minHip,
        spineRange,
        duration,
        hardFails,
        softFails,
        feedback
      });

      return {
        ...repRecord,
        score: finalScore,
        breakdown,
        feedback,
        hardFails,
        softFails,
        view,
        confidence,
        summary: {
          ...summary,
          finalScore,
          feedback,
          hardFails,
          softFails,
          dominantView: view,
          confidence
        }
      };
    },

    filterLiveFeedback(scoreResult, runtime) {
      return this.prepareLiveScoreResult(scoreResult, runtime);
    },

    prepareLiveScoreResult(scoreResult, runtime) {
      if (!scoreResult?.breakdown?.length) {
        return scoreResult;
      }

      const phase = runtime?.repCounter?.currentPhase || REP_PHASES.NEUTRAL;
      const currentState = runtime?.repCounter?.currentState || window.REP_STATES?.NEUTRAL;
      const livePhase = getLivePhase(currentState, phase);
      const breakdown = scoreResult.breakdown.filter((item) => shouldKeepLiveMetric(item.key, livePhase));

      if (breakdown.length === scoreResult.breakdown.length) {
        return scoreResult;
      }

      if (breakdown.length === 0) {
        return {
          ...scoreResult,
          breakdown: []
        };
      }

      return {
        ...scoreResult,
        score: calculateLiveScore(breakdown, scoreResult.score),
        breakdown
      };
    },

    shouldAccumulateRepMetrics(runtime) {
      const phase = runtime?.repCounter?.currentPhase;
      return SCORING_PHASES.includes(phase);
    }
  };

  function detectPhase(repCounter, angles, primaryAngle) {
    const hipAngle = repCounter.getAngleValue(angles, 'hip_angle');
    const delta = repCounter.previousPrimaryAngle == null ? 0 : (primaryAngle - repCounter.previousPrimaryAngle);
    const nearBottom = primaryAngle <= ((repCounter.pattern.thresholds.active || 95) + 8);
    const nearLockout = primaryAngle >= ((repCounter.pattern.thresholds.neutral || 155) - 10) &&
      (hipAngle == null || hipAngle >= 145);
    const movingDown = delta <= -1.5;
    const movingUp = delta >= 1.5;

    if (repCounter.currentState === window.REP_STATES?.NEUTRAL) {
      return (repCounter.bottomReached || repCounter.ascentStarted) ? REP_PHASES.LOCKOUT : REP_PHASES.NEUTRAL;
    }

    if (!repCounter.bottomReached) {
      if (nearBottom) {
        repCounter.bottomStableFrames = Math.abs(delta) <= 2 ? repCounter.bottomStableFrames + 1 : 1;
        if (repCounter.bottomStableFrames >= 2 || (!movingDown && repCounter.currentState === window.REP_STATES?.ACTIVE)) {
          repCounter.bottomReached = true;
          return REP_PHASES.BOTTOM;
        }
      } else {
        repCounter.bottomStableFrames = 0;
      }

      return REP_PHASES.DESCENT;
    }

    if (!repCounter.ascentStarted) {
      if (movingUp || repCounter.currentState !== window.REP_STATES?.ACTIVE) {
        repCounter.ascentStarted = true;
        return nearLockout ? REP_PHASES.LOCKOUT : REP_PHASES.ASCENT;
      }

      return REP_PHASES.BOTTOM;
    }

    if (nearLockout && repCounter.currentState === window.REP_STATES?.NEUTRAL) {
      return REP_PHASES.LOCKOUT;
    }

    return REP_PHASES.ASCENT;
  }

  function createRepSummary(repCounter, startedAt) {
    return {
      exerciseCode: 'push_up',
      startedAt,
      durationMs: 0,
      finalPhase: REP_PHASES.NEUTRAL,
      flags: {
        bottomReached: false,
        ascentStarted: false,
        lockoutReached: false
      },
      views: {
        FRONT: 0,
        SIDE: 0,
        UNKNOWN: 0
      },
      quality: {
        scoreSum: 0,
        count: 0,
        levels: {
          HIGH: 0,
          MEDIUM: 0,
          LOW: 0,
          UNKNOWN: 0
        }
      },
      overall: createPhaseSummary(repCounter),
      phases: {
        DESCENT: createPhaseSummary(repCounter),
        BOTTOM: createPhaseSummary(repCounter),
        ASCENT: createPhaseSummary(repCounter),
        LOCKOUT: createPhaseSummary(repCounter)
      }
    };
  }

  function createPhaseSummary(repCounter) {
    return {
      samples: 0,
      durationMs: 0,
      views: {
        FRONT: 0,
        SIDE: 0,
        UNKNOWN: 0
      },
      qualityLevels: {
        HIGH: 0,
        MEDIUM: 0,
        LOW: 0,
        UNKNOWN: 0
      },
      metrics: {
        elbowAngle: repCounter.createMetricStats(),
        hipAngle: repCounter.createMetricStats(),
        spineAngle: repCounter.createMetricStats(),
        shoulderAngle: repCounter.createMetricStats(),
        qualityScore: repCounter.createMetricStats()
      }
    };
  }

  function getSnapshot(repCounter, angles, primaryAngle) {
    const qualityScore = Number.isFinite(angles.quality?.score) ? angles.quality.score : null;

    return {
      elbowAngle: primaryAngle,
      hipAngle: repCounter.getAngleValue(angles, 'hip_angle'),
      spineAngle: repCounter.getAngleValue(angles, 'spine_angle'),
      shoulderAngle: repCounter.getAngleValue(angles, 'shoulder_angle'),
      qualityScore,
      view: angles.view || 'UNKNOWN',
      qualityLevel: angles.quality?.level || 'UNKNOWN'
    };
  }

  function incrementBucketValue(bucket, key) {
    const normalized = Object.prototype.hasOwnProperty.call(bucket, key) ? key : 'UNKNOWN';
    bucket[normalized]++;
  }

  function recordFrame(repCounter, phase, deltaMs, snapshot) {
    const summary = repCounter.currentRepSummary;
    if (!summary) return;

    const phaseSummary = summary.phases[phase];

    summary.durationMs += deltaMs;
    summary.finalPhase = phase;
    summary.flags.bottomReached = repCounter.bottomReached;
    summary.flags.ascentStarted = repCounter.ascentStarted;
    summary.flags.lockoutReached = summary.flags.lockoutReached || phase === REP_PHASES.LOCKOUT;

    incrementBucketValue(summary.views, snapshot.view);
    incrementBucketValue(summary.quality.levels, snapshot.qualityLevel);
    if (Number.isFinite(snapshot.qualityScore)) {
      summary.quality.scoreSum += snapshot.qualityScore;
      summary.quality.count++;
    }

    recordPhaseFrame(repCounter, summary.overall, deltaMs, snapshot);
    if (phaseSummary) {
      recordPhaseFrame(repCounter, phaseSummary, deltaMs, snapshot);
    }
  }

  function recordPhaseFrame(repCounter, target, deltaMs, snapshot) {
    target.samples++;
    target.durationMs += deltaMs;
    incrementBucketValue(target.views, snapshot.view);
    incrementBucketValue(target.qualityLevels, snapshot.qualityLevel);

    repCounter.updateMetricStats(target.metrics.elbowAngle, snapshot.elbowAngle);
    repCounter.updateMetricStats(target.metrics.hipAngle, snapshot.hipAngle);
    repCounter.updateMetricStats(target.metrics.spineAngle, snapshot.spineAngle);
    repCounter.updateMetricStats(target.metrics.shoulderAngle, snapshot.shoulderAngle);
    repCounter.updateMetricStats(target.metrics.qualityScore, snapshot.qualityScore);
  }

  function getScoringPhaseConfidence(summary) {
    let weightedSum = 0;
    let totalCount = 0;

    for (const phase of SCORING_PHASES) {
      const qualityStats = summary?.phases?.[phase]?.metrics?.qualityScore;
      if (!qualityStats || !Number.isFinite(qualityStats.sum) || !Number.isFinite(qualityStats.count) || qualityStats.count <= 0) {
        continue;
      }

      weightedSum += qualityStats.sum;
      totalCount += qualityStats.count;
    }

    if (totalCount > 0) {
      return weightedSum / totalCount;
    }

    return summary.quality.count > 0 ? summary.quality.scoreSum / summary.quality.count : 0;
  }

  function finalizePhaseSummary(repCounter, summary) {
    return {
      samples: summary.samples,
      durationMs: Math.round(summary.durationMs),
      views: summary.views,
      qualityLevels: summary.qualityLevels,
      metrics: Object.fromEntries(
        Object.entries(summary.metrics).map(([key, stats]) => [key, repCounter.finalizeMetricStats(stats)])
      )
    };
  }

  function getMetricRange(summary, phases, metricKey) {
    let min = null;
    let max = null;

    for (const phase of phases) {
      const stats = summary?.phases?.[phase]?.metrics?.[metricKey];
      if (!stats || stats.count <= 0) continue;
      if (Number.isFinite(stats.min)) {
        min = min == null ? stats.min : Math.min(min, stats.min);
      }
      if (Number.isFinite(stats.max)) {
        max = max == null ? stats.max : Math.max(max, stats.max);
      }
    }

    if (min == null || max == null) {
      const overall = summary?.overall?.metrics?.[metricKey];
      if (overall && overall.count > 0 && Number.isFinite(overall.min) && Number.isFinite(overall.max)) {
        return Math.round((overall.max - overall.min) * 10) / 10;
      }
      return null;
    }

    return Math.round((max - min) * 10) / 10;
  }

  function getMetricPlan(values) {
    return [
      {
        key: 'elbow_depth',
        title: '푸쉬업 깊이',
        maxScore: 35,
        weight: 0.35,
        scorer: () => scoreDepth(values.bottomElbow),
        rawValue: () => values.bottomElbow,
        feedback: '가슴을 조금 더 내려주세요'
      },
      {
        key: 'elbow_lockout',
        title: '팔 펴기',
        maxScore: 25,
        weight: 0.2,
        scorer: () => scoreLockout(values.lockoutElbow),
        rawValue: () => values.lockoutElbow,
        feedback: '올라올 때 팔을 끝까지 펴주세요'
      },
      {
        key: 'hip_angle',
        title: '몸통 일직선',
        maxScore: 25,
        weight: 0.25,
        scorer: () => scoreBodyLine(values.minHip),
        rawValue: () => values.minHip,
        feedback: '엉덩이가 처지지 않게 몸을 일직선으로 유지해주세요'
      },
      {
        key: 'spine_stability',
        title: '상체 안정성',
        maxScore: 10,
        weight: 0.1,
        scorer: () => scoreSpineRange(values.spineRange),
        rawValue: () => values.spineRange,
        feedback: '머리부터 골반까지 같은 각도로 움직여주세요'
      },
      {
        key: 'tempo',
        title: '동작 템포',
        maxScore: 10,
        weight: 0.1,
        scorer: () => scoreTempo(values.duration),
        rawValue: () => values.duration,
        feedback: '너무 급하게 하지 말고 일정한 속도로 반복해주세요'
      }
    ];
  }

  function scoreDepth(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 95) return 100;
    if (value <= 105) return interpolate(value, 95, 105, 100, 82);
    if (value <= 115) return interpolate(value, 105, 115, 82, 45);
    return 15;
  }

  function scoreLockout(value) {
    if (!Number.isFinite(value)) return null;
    if (value >= 160) return 100;
    if (value >= 150) return interpolate(value, 150, 160, 80, 100);
    if (value >= 145) return interpolate(value, 145, 150, 55, 80);
    return 20;
  }

  function scoreBodyLine(value) {
    if (!Number.isFinite(value)) return null;
    if (value >= 165) return 100;
    if (value >= 155) return interpolate(value, 155, 165, 80, 100);
    if (value >= 145) return interpolate(value, 145, 155, 45, 80);
    return 15;
  }

  function scoreSpineRange(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 8) return 100;
    if (value <= 15) return interpolate(value, 8, 15, 100, 80);
    if (value <= 25) return interpolate(value, 15, 25, 80, 45);
    return 20;
  }

  function scoreTempo(value) {
    if (!Number.isFinite(value)) return null;
    if (value >= 900 && value <= 2500) return 100;
    if (value >= 700 && value < 900) return interpolate(value, 700, 900, 70, 100);
    if (value > 2500 && value <= 3500) return interpolate(value, 2500, 3500, 100, 70);
    if (value >= 500 && value < 700) return interpolate(value, 500, 700, 35, 70);
    if (value > 3500 && value <= 5000) return interpolate(value, 3500, 5000, 70, 35);
    return 20;
  }

  function interpolate(value, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMax;
    const ratio = (value - inMin) / (inMax - inMin);
    return outMin + ((outMax - outMin) * ratio);
  }

  function pickFeedback({ hardFails, breakdown, confidence, minHip, spineRange }) {
    if (hardFails.includes('low_confidence') || confidence.level === 'LOW') {
      return '카메라에 전신이 잘 보이도록 위치를 다시 맞춰주세요';
    }
    if (hardFails.includes('view_mismatch')) {
      return '몸을 측면으로 유지한 상태에서 푸쉬업을 진행해주세요';
    }
    if (hardFails.includes('depth_not_reached')) {
      return '가슴을 조금 더 내려주세요';
    }
    if (hardFails.includes('body_line_broken')) {
      return '엉덩이가 처지지 않게 몸을 일직선으로 유지해주세요';
    }
    if (hardFails.includes('lockout_incomplete')) {
      return '올라올 때 팔을 끝까지 펴주세요';
    }

    const worstMetric = breakdown
      .slice()
      .sort((a, b) => (a.score / (a.maxScore || 1)) - (b.score / (b.maxScore || 1)))[0];

    if (worstMetric?.feedback) {
      return worstMetric.feedback;
    }

    if (Number.isFinite(minHip) && minHip < 155) {
      return '엉덩이가 처지지 않게 몸을 일직선으로 유지해주세요';
    }
    if (Number.isFinite(spineRange) && spineRange > 15) {
      return '머리부터 골반까지 같은 각도로 움직여주세요';
    }

    return '좋아요! 같은 리듬으로 반복해보세요';
  }

  function getLivePhase(currentState, phase) {
    const isTopPhase = currentState === window.REP_STATES?.NEUTRAL ||
      phase === REP_PHASES.NEUTRAL ||
      phase === REP_PHASES.LOCKOUT;

    if (isTopPhase) return REP_PHASES.LOCKOUT;
    if (phase === REP_PHASES.DESCENT) return REP_PHASES.DESCENT;
    if (phase === REP_PHASES.BOTTOM) return REP_PHASES.BOTTOM;
    if (phase === REP_PHASES.ASCENT) return REP_PHASES.ASCENT;
    return REP_PHASES.DESCENT;
  }

  function shouldKeepLiveMetric(metricKey, phase) {
    const category = getMetricCategory(metricKey);
    if (category === 'other') return false;

    if (phase === REP_PHASES.LOCKOUT) {
      return category === 'lockout' || category === 'body' || category === 'torso';
    }

    if (phase === REP_PHASES.DESCENT || phase === REP_PHASES.BOTTOM) {
      return category === 'depth' || category === 'body' || category === 'torso';
    }

    if (phase === REP_PHASES.ASCENT) {
      return category === 'lockout' || category === 'body' || category === 'torso';
    }

    return false;
  }

  function getMetricCategory(metricKey) {
    const key = (metricKey || '').toString().toLowerCase();
    if (!key) return 'other';

    if (key.includes('lockout')) return 'lockout';
    if (key.includes('depth')) return 'depth';
    if (key.includes('spine') || key.includes('torso')) return 'torso';
    if (key.includes('hip')) return 'body';
    return 'other';
  }

  function calculateLiveScore(breakdown, fallbackScore) {
    let weightedScore = 0;
    let totalWeight = 0;

    for (const item of breakdown) {
      if (!Number.isFinite(item?.score)) continue;
      const weight = Number.isFinite(item?.weight) && item.weight > 0 ? item.weight : 1;
      weightedScore += item.score * weight;
      totalWeight += weight;
    }

    return totalWeight > 0 ? Math.round(weightedScore / totalWeight) : fallbackScore;
  }

  registry.register('push_up', pushUpExercise);
  registry.register('pushup', pushUpExercise);
})();
