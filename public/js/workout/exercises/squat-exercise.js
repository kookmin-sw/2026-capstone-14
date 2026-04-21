/* EXERCISE_MANIFEST
{
  "code": "SQUAT",
  "name": "스쿼트",
  "description": "하체운동의 기본 스쿼트",
  "default_target_type": "REPS",
  "allowed_views": ["FRONT", "SIDE", "DIAGONAL"],
  "default_view": "FRONT",
  "sort_order": 10
}
*/
/**
 * 스쿼트 전용 rep 추적/채점/품질 게이트
 */
(function registerSquatExerciseModule() {
  const registry = typeof window !== 'undefined' ? window.WorkoutExerciseRegistry : null;
  if (!registry) return;

  const REP_PHASES = {
    NEUTRAL: 'NEUTRAL',
    DESCENT: 'DESCENT',
    BOTTOM: 'BOTTOM',
    ASCENT: 'ASCENT',
    LOCKOUT: 'LOCKOUT'
  };
  const SCORING_PHASES = [REP_PHASES.DESCENT, REP_PHASES.BOTTOM, REP_PHASES.ASCENT];

  const squatExercise = {
    code: 'squat',

    getDefaultProfileMetrics() {
      return [
        {
          weight: 0.3,
          max_score: 30,
          rule: { type: 'position' },
          metric: {
            metric_id: 'squat_depth',
            key: 'depth',
            title: '스쿼트 깊이',
            unit: 'SCORE'
          }
        },
        {
          weight: 0.2,
          max_score: 20,
          rule: { ideal_min: 60, ideal_max: 120, acceptable_min: 45, acceptable_max: 140 },
          metric: {
            metric_id: 'squat_hip_angle',
            key: 'hip_angle',
            title: '힙 힌지',
            unit: 'DEG'
          }
        },
        {
          weight: 0.2,
          max_score: 20,
          rule: { ideal_min: 0, ideal_max: 50, acceptable_min: 0, acceptable_max: 65 },
          metric: {
            metric_id: 'squat_spine_angle',
            key: 'spine_angle',
            title: '상체 안정성',
            unit: 'DEG'
          }
        },
        {
          weight: 0.15,
          max_score: 15,
          rule: { type: 'position' },
          metric: {
            metric_id: 'squat_knee_alignment',
            key: 'knee_alignment',
            title: '무릎 정렬',
            unit: 'SCORE'
          }
        },
        {
          weight: 0.15,
          max_score: 15,
          rule: { type: 'symmetry', max_diff: 12 },
          metric: {
            metric_id: 'squat_knee_symmetry',
            key: 'knee_symmetry',
            title: '좌우 무릎 대칭',
            unit: 'DEG'
          }
        }
      ];
    },

    getRepPattern() {
      return {
        primaryAngle: 'knee_angle',
        thresholds: {
          neutral: 160,
          active: 100
        },
        direction: 'decrease',
        minDuration: 800,
        minActiveTime: 200
      };
    },

    getFrameGate(angles, runtime) {
      const quality = angles?.quality || {};
      const view = angles?.view || 'UNKNOWN';
      const selectedView = runtime?.selectedView || runtime?.state?.selectedView || null;
      const trackedJointRatio = quality.trackedJointRatio ?? 0;
      const inFrameRatio = quality.inFrameRatio ?? 0;
      const score = quality.score ?? 0;

      if (trackedJointRatio < 0.75) {
        return {
          isReady: false,
          reason: 'tracked_joints_low',
          message: '무릎과 발목까지 전신이 충분히 보이도록 카메라를 맞춰주세요'
        };
      }

      if (inFrameRatio < 0.75) {
        return {
          isReady: false,
          reason: 'out_of_frame',
          message: '발과 하체가 잘리지 않도록 카메라를 조금 더 멀리 두세요'
        };
      }

      if (view === 'UNKNOWN') {
        return {
          isReady: false,
          reason: 'view_unknown',
          message: '정면 또는 측면이 잘 보이도록 몸 방향을 맞춰주세요'
        };
      }

      if (selectedView && selectedView !== 'DIAGONAL' && view !== selectedView) {
        return {
          isReady: false,
          reason: 'view_mismatch',
          message: `선택한 ${selectedView} 자세에 맞게 몸 방향을 조정해주세요`
        };
      }

      if (score < 0.5) {
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

      const bottomKnee = scoringEngine.pickMetric(summary, ['BOTTOM', 'DESCENT', 'ASCENT'], 'kneeAngle', 'min');
      const bottomHip = scoringEngine.pickMetric(summary, ['BOTTOM', 'DESCENT'], 'hipAngle', 'min');
      const maxSpine = scoringEngine.pickMetric(summary, ['DESCENT', 'BOTTOM', 'ASCENT'], 'spineAngle', 'max');
      const kneeSymmetry = scoringEngine.pickMetric(summary, ['BOTTOM', 'ASCENT', 'DESCENT'], 'kneeSymmetry', 'avg');
      const kneeAlignment = view === 'FRONT'
        ? scoringEngine.pickPhaseMetric(summary, ['BOTTOM', 'ASCENT'], 'kneeAlignment', 'avg')
        : scoringEngine.pickMetric(summary, ['BOTTOM', 'ASCENT', 'DESCENT'], 'kneeAlignment', 'avg');
      const lockoutKnee = scoringEngine.pickMetric(summary, ['LOCKOUT', 'ASCENT'], 'kneeAngle', 'max');

      const hardFails = [];
      if (!summary.flags?.bottomReached || bottomKnee == null || bottomKnee > 125) {
        hardFails.push('depth_not_reached');
      }
      if (!summary.flags?.lockoutReached || (lockoutKnee != null && lockoutKnee < 150)) {
        hardFails.push('lockout_incomplete');
      }
      if (confidence.level === 'LOW') {
        hardFails.push('low_confidence');
      }

      const metricPlan = getMetricPlan(view, {
        bottomKnee,
        bottomHip,
        maxSpine,
        kneeSymmetry,
        kneeAlignment
      });
      const breakdown = [];
      let weightedScore = 0;
      let totalWeight = 0;

      for (const item of metricPlan) {
        const normalizedScore = item.scorer(scoringEngine);
        if (!Number.isFinite(normalizedScore)) continue;

        const metric = scoringEngine.getProfileMetricConfig(item.key, item.title);
        const dynamicMaxScore = Math.round(item.weight * 100);
        const score = Math.round((normalizedScore / 100) * dynamicMaxScore);
        breakdown.push({
          metric_id: metric.metric_id,
          key: item.key,
          title: metric.title,
          rawValue: item.rawValue(),
          score,
          normalizedScore: Math.round(normalizedScore * 100) / 100,
          maxScore: dynamicMaxScore,
          weight: item.weight,
          feedback: normalizedScore < 70 ? item.feedback : null
        });

        weightedScore += normalizedScore * item.weight;
        totalWeight += item.weight;
      }

      const baseScore = totalWeight > 0 ? (weightedScore / totalWeight) : (repRecord.score || 0);
      let finalScore = baseScore * (confidence.factor || 0.7);

      if (hardFails.includes('depth_not_reached')) {
        finalScore = Math.min(finalScore, 55);
      }
      if (hardFails.includes('lockout_incomplete')) {
        finalScore = Math.min(finalScore, 65);
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
        view,
        confidence,
        bottomHip,
        maxSpine
      });

      console.log('[ScoringEngine][Squat] Rep evaluation:', {
        repNumber: repRecord.repNumber,
        scoreBeforeRepScoring: repRecord.score,
        finalScore,
        view,
        confidenceLevel: confidence.level,
        confidenceScore: confidence.score,
        bottomKnee,
        bottomHip,
        maxSpine,
        kneeSymmetry,
        kneeAlignment,
        lockoutKnee,
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
      const view = runtime?.angles?.view || 'UNKNOWN';
      const livePhase = getLivePhase(currentState, phase);
      const breakdown = scoreResult.breakdown.filter((item) =>
        shouldKeepLiveMetric(item.key, livePhase, view)
      );

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
    const nearBottom = primaryAngle <= ((repCounter.pattern.thresholds.active || 100) + 8);
    const nearLockout = primaryAngle >= ((repCounter.pattern.thresholds.neutral || 160) - 10) &&
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
      exerciseCode: 'squat',
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
        kneeAngle: repCounter.createMetricStats(),
        hipAngle: repCounter.createMetricStats(),
        spineAngle: repCounter.createMetricStats(),
        kneeSymmetry: repCounter.createMetricStats(),
        kneeAlignment: repCounter.createMetricStats(),
        qualityScore: repCounter.createMetricStats()
      }
    };
  }

  function getSnapshot(repCounter, angles, primaryAngle) {
    const leftKnee = Number.isFinite(angles.leftKnee) ? angles.leftKnee : null;
    const rightKnee = Number.isFinite(angles.rightKnee) ? angles.rightKnee : null;
    const kneeSymmetry = leftKnee != null && rightKnee != null ? Math.abs(leftKnee - rightKnee) : null;
    const kneeAlignment = angles.kneeAlignment
      ? (Math.abs(angles.kneeAlignment.left || 0) + Math.abs(angles.kneeAlignment.right || 0)) / 2
      : null;
    const qualityScore = Number.isFinite(angles.quality?.score) ? angles.quality.score : null;

    return {
      kneeAngle: primaryAngle,
      hipAngle: repCounter.getAngleValue(angles, 'hip_angle'),
      spineAngle: repCounter.getAngleValue(angles, 'spine_angle'),
      kneeSymmetry,
      kneeAlignment,
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

    repCounter.updateMetricStats(target.metrics.kneeAngle, snapshot.kneeAngle);
    repCounter.updateMetricStats(target.metrics.hipAngle, snapshot.hipAngle);
    repCounter.updateMetricStats(target.metrics.spineAngle, snapshot.spineAngle);
    repCounter.updateMetricStats(target.metrics.kneeSymmetry, snapshot.kneeSymmetry);
    repCounter.updateMetricStats(target.metrics.kneeAlignment, snapshot.kneeAlignment);
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

  function getMetricPlan(view, values) {
    const common = {
      depth: {
        key: 'depth',
        title: '스쿼트 깊이',
        scorer: () => scoreDepth(values.bottomKnee),
        rawValue: () => values.bottomKnee,
        feedback: '조금 더 깊이 앉아주세요'
      },
      hip: {
        key: 'hip_angle',
        title: '힙 힌지',
        scorer: () => scoreHip(values.bottomHip),
        rawValue: () => values.bottomHip,
        feedback: '엉덩이를 뒤로 보내며 앉아주세요'
      },
      spine: {
        key: 'spine_angle',
        title: '상체 안정성',
        scorer: () => scoreSpine(values.maxSpine),
        rawValue: () => values.maxSpine,
        feedback: '가슴을 들고 상체를 더 안정적으로 유지해주세요'
      },
      symmetry: {
        key: 'knee_symmetry',
        title: '좌우 무릎 대칭',
        scorer: () => scoreSymmetry(values.kneeSymmetry),
        rawValue: () => values.kneeSymmetry,
        feedback: '양쪽 무릎 높이와 각도를 비슷하게 맞춰주세요'
      },
      alignment: {
        key: 'knee_alignment',
        title: '무릎 정렬',
        scorer: () => scoreAlignment(values.kneeAlignment),
        rawValue: () => values.kneeAlignment,
        feedback: '무릎이 발끝 방향을 유지하도록 해주세요'
      }
    };

    const plans = {
      SIDE: [
        { ...common.depth, weight: 0.4 },
        { ...common.hip, weight: 0.25 },
        { ...common.spine, weight: 0.2 },
        { ...common.alignment, weight: 0.15 }
      ],
      FRONT: [
        { ...common.symmetry, weight: 0.35 },
        { ...common.alignment, weight: 0.35 },
        { ...common.depth, weight: 0.2 },
        { ...common.spine, weight: 0.1 }
      ],
      UNKNOWN: [
        { ...common.depth, weight: 0.3 },
        { ...common.alignment, weight: 0.25 },
        { ...common.symmetry, weight: 0.2 },
        { ...common.spine, weight: 0.15 },
        { ...common.hip, weight: 0.1 }
      ]
    };

    return plans[['SIDE', 'FRONT'].includes(view) ? view : 'UNKNOWN'];
  }

  function scoreDepth(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 100) return 100;
    if (value <= 115) return interpolate(value, 100, 115, 100, 80);
    if (value <= 125) return interpolate(value, 115, 125, 80, 35);
    return 15;
  }

  function scoreHip(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 120) return 100;
    if (value <= 140) return interpolate(value, 120, 140, 100, 65);
    if (value <= 155) return interpolate(value, 140, 155, 65, 25);
    return 10;
  }

  function scoreSpine(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 25) return 100;
    if (value <= 40) return interpolate(value, 25, 40, 100, 80);
    if (value <= 55) return interpolate(value, 40, 55, 80, 45);
    return 20;
  }

  function scoreSymmetry(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 8) return 100;
    if (value <= 15) return interpolate(value, 8, 15, 100, 75);
    if (value <= 25) return interpolate(value, 15, 25, 75, 35);
    return 15;
  }

  function scoreAlignment(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 0.05) return 100;
    if (value <= 0.08) return interpolate(value, 0.05, 0.08, 100, 75);
    if (value <= 0.12) return interpolate(value, 0.08, 0.12, 75, 35);
    return 15;
  }

  function interpolate(value, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMax;
    const ratio = (value - inMin) / (inMax - inMin);
    return outMin + ((outMax - outMin) * ratio);
  }

  function pickFeedback({ hardFails, breakdown, view, confidence, bottomHip, maxSpine }) {
    if (hardFails.includes('low_confidence') || confidence.level === 'LOW') {
      return '카메라에 전신이 잘 보이도록 위치를 다시 맞춰주세요';
    }
    if (hardFails.includes('depth_not_reached')) {
      return '조금 더 깊이 앉아주세요';
    }
    if (hardFails.includes('lockout_incomplete')) {
      return '올라올 때 무릎과 엉덩이를 끝까지 펴주세요';
    }

    const worstMetric = breakdown
      .slice()
      .sort((a, b) => (a.score / (a.maxScore || 1)) - (b.score / (b.maxScore || 1)))[0];

    if (worstMetric?.feedback) {
      return worstMetric.feedback;
    }

    if (view === 'SIDE' && Number.isFinite(bottomHip) && bottomHip > 140) {
      return '엉덩이를 뒤로 보내며 앉아주세요';
    }
    if (view === 'SIDE' && Number.isFinite(maxSpine) && maxSpine > 40) {
      return '가슴을 들고 상체를 더 안정적으로 유지해주세요';
    }

    return '좋아요! 같은 흐름으로 반복해보세요';
  }

  function getLivePhase(currentState, phase) {
    const isStandingPhase = currentState === window.REP_STATES?.NEUTRAL ||
      phase === REP_PHASES.NEUTRAL ||
      phase === REP_PHASES.LOCKOUT;

    if (isStandingPhase) return REP_PHASES.LOCKOUT;
    if (phase === REP_PHASES.DESCENT) return REP_PHASES.DESCENT;
    if (phase === REP_PHASES.BOTTOM) return REP_PHASES.BOTTOM;
    if (phase === REP_PHASES.ASCENT) return REP_PHASES.ASCENT;
    return REP_PHASES.DESCENT;
  }

  function shouldKeepLiveMetric(metricKey, phase, view) {
    const category = getMetricCategory(metricKey);
    if (category === 'other') return false;

    // 시점(View)에 따른 유효성 필터링: 화면 각도상 정확한 측정이 불가능한 항목 제외
    if (view === 'FRONT' && category === 'hip') return false;
    if (view === 'SIDE' && category === 'symmetry') return false;

    // 기본 평가는 모든 phase에 적용
    if (category === 'torso' || category === 'alignment' || category === 'symmetry') {
      return true;
    }

    // 힙 힌지는 앉는 동작에서만 중요 (서 있을 때는 각도가 180도이므로 평가 시 무조건 감점됨)
    if (category === 'hip') {
      return phase === REP_PHASES.DESCENT || phase === REP_PHASES.BOTTOM;
    }

    // 깊이(다리 각도) 평가는 완전히 내려갔을 때(BOTTOM)만 적용
    if (category === 'depth') {
      return phase === REP_PHASES.BOTTOM;
    }

    return false;
  }

  function getMetricCategory(metricKey) {
    const key = (metricKey || '').toString().toLowerCase();
    if (!key) return 'other';

    if (key.includes('spine') || key.includes('torso') || key.includes('back')) {
      return 'torso';
    }
    if (key.includes('hip')) {
      return 'hip';
    }
    if (key.includes('symmetry')) {
      return 'symmetry';
    }
    if (key === 'knee_alignment' || key === 'knee_over_toe') {
      return 'alignment';
    }
    if (key === 'depth' || key === 'knee_angle' || key === 'knee_depth' || key === 'left_knee_angle' || key === 'right_knee_angle') {
      return 'depth';
    }

    return 'other';
  }

  function calculateLiveScore(breakdown, fallbackScore) {
    let scoreSum = 0;
    let maxScoreSum = 0;

    for (const item of breakdown) {
      if (!Number.isFinite(item?.score) || !Number.isFinite(item?.maxScore)) continue;
      scoreSum += item.score;
      maxScoreSum += item.maxScore;
    }

    return maxScoreSum > 0 ? Math.round((scoreSum / maxScoreSum) * 100) : fallbackScore;
  }

  registry.register('squat', squatExercise);
})();

/**
 * view별 스쿼트 채점 metric 우선순위 반환
 * - FRONT: knee_alignment 1차, depth 2차 / hip_hinge는 hard-fail 불가
 * - SIDE: depth + hip_hinge 1차, torso_stability 2차 / knee_alignment는 hard-fail 불가
 * - DIAGONAL (기본): depth 1차, torso_stability 2차 / knee_alignment는 hard-fail 불가
 */
function getSquatMetricPriority(view) {
  if (view === 'FRONT') {
    return {
      primary: ['knee_alignment'],
      secondary: ['depth'],
      disallowedHardFailMetrics: ['hip_hinge'],
    };
  }
  if (view === 'SIDE') {
    return {
      primary: ['depth', 'hip_hinge'],
      secondary: ['torso_stability'],
      disallowedHardFailMetrics: ['knee_alignment'],
    };
  }
  // DIAGONAL and unknown views
  return {
    primary: ['depth'],
    secondary: ['torso_stability'],
    disallowedHardFailMetrics: ['knee_alignment'],
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    ...(module.exports || {}),
    getSquatMetricPriority,
  };
}
