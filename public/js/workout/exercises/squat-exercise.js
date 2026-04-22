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
          weight: 0.35,
          max_score: 35,
          rule: {
            ideal_min: 90,
            ideal_max: 100,
            acceptable_min: 50,
            acceptable_max: 100,
            feedback_low: '더 깊이 앉아주세요'
          },
          metric: {
            metric_id: 'squat_depth',
            key: 'depth',
            title: '스쿼트 깊이',
            unit: 'DEG'
          }
        },
        {
          weight: 0.2,
          max_score: 20,
          rule: {
            ideal_min: 70,
            ideal_max: 110,
            acceptable_min: 55,
            acceptable_max: 130,
            feedback_low: '엉덩이를 더 뒤로 복사하며 앉아주세요',
            feedback_high: '상체를 너무 숙였습니다. 가슴을 세워주세요'
          },
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
          rule: {
            ideal_min: 0,
            ideal_max: 30,
            acceptable_min: 0,
            acceptable_max: 50,
            feedback_low: '가슴을 들고 등을 곧게 펴주세요',
            feedback_high: '상체가 너무 기울어졌어요'
          },
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
          rule: {
            ideal_min: 0,
            ideal_max: 10,
            acceptable_min: 0,
            acceptable_max: 20,
            feedback_low: '상체와 다리가 평행하도록 자세를 유지해주세요',
            feedback_high: '상체가 너무 누워있습니다'
          },
          metric: {
            metric_id: 'squat_trunk_tibia',
            key: 'trunk_tibia_angle',
            title: '상체-다리 평행도',
            unit: 'DEG'
          }
        },
        {
          weight: 0.1,
          max_score: 10,
          rule: {
            type: 'position'
          },
          metric: {
            metric_id: 'squat_knee_alignment',
            key: 'knee_alignment',
            title: '무릎 정렬',
            unit: 'SCORE'
          }
        },
        {
          weight: 0.10,
          max_score: 10,
          rule: {
            type: 'boolean'
          },
          metric: {
            metric_id: 'squat_heel_contact',
            key: 'heel_contact',
            title: '뒤꿈치 접지',
            unit: 'BOOL'
          }
        },
        {
          weight: 0.10,
          max_score: 10,
          rule: {
            ideal_min: 0,
            ideal_max: 0.03,
            acceptable_min: 0,
            acceptable_max: 0.08,
            feedback_low: '무릎이 안쪽으로 무너지지 않도록 바깥쪽 힘으로 밀어주세요',
            feedback_high: '무릎이 지나치게 바깥으로 벌어졌습니다'
          },
          metric: {
            metric_id: 'squat_knee_valgus',
            key: 'knee_valgus',
            title: '무릎 안쪽 무너짐',
            unit: 'RATIO'
          }
        },
        {
          weight: 0.15,
          max_score: 15,
          rule: {
            type: 'symmetry',
            max_diff: 18,
            feedback: '양쪽 무릎 각도를 맞춰주세요'
          },
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

      const maxTrunkTibia = scoringEngine.pickMetric(summary, ['DESCENT', 'BOTTOM', 'ASCENT'], 'trunkTibiaAngle', 'max');
      const avgHeelContact = scoringEngine.pickMetric(summary, ['DESCENT', 'BOTTOM', 'ASCENT'], 'heelContact', 'avg');
      const bottomHipBelowKnee = scoringEngine.pickMetric(summary, ['BOTTOM'], 'hipBelowKnee', 'min');
      const avgKneeValgus = scoringEngine.pickMetric(summary, ['BOTTOM', 'ASCENT', 'DESCENT'], 'kneeValgus', 'avg');

      const depthReachedByAngle = Number.isFinite(bottomKnee) && bottomKnee <= 130;
      const depthReachedByHip = bottomHipBelowKnee === 1;

      const hardFails = [];
      if (!depthReachedByAngle && !depthReachedByHip) {
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
        maxTrunkTibia,
        avgHeelContact,
        bottomHipBelowKnee,
        avgKneeValgus,
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
        maxSpine,
        maxTrunkTibia,
        avgHeelContact,
        avgKneeValgus
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

    if (repCounter.currentState === 'NEUTRAL') {
      return (repCounter.bottomReached || repCounter.ascentStarted) ? REP_PHASES.LOCKOUT : REP_PHASES.NEUTRAL;
    }

    if (!repCounter.bottomReached) {
      if (nearBottom) {
        repCounter.bottomStableFrames = Math.abs(delta) <= 2 ? repCounter.bottomStableFrames + 1 : 1;
        if (repCounter.bottomStableFrames >= 2 || (!movingDown && repCounter.currentState === 'ACTIVE')) {
          repCounter.bottomReached = true;
          return REP_PHASES.BOTTOM;
        }
      } else {
        repCounter.bottomStableFrames = 0;
      }

      return REP_PHASES.DESCENT;
    }

    if (!repCounter.ascentStarted) {
      if (movingUp || repCounter.currentState !== 'ACTIVE') {
        repCounter.ascentStarted = true;
        return nearLockout ? REP_PHASES.LOCKOUT : REP_PHASES.ASCENT;
      }

      return REP_PHASES.BOTTOM;
    }

    if (nearLockout && repCounter.currentState === 'NEUTRAL') {
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
        qualityScore: repCounter.createMetricStats(),
        tibiaAngle: repCounter.createMetricStats(),
        trunkTibiaAngle: repCounter.createMetricStats(),
        heelContact: repCounter.createMetricStats(),
        hipBelowKnee: repCounter.createMetricStats(),
        kneeValgus: repCounter.createMetricStats()
      }
    };
  }

  function getSnapshot(repCounter, angles, primaryAngle) {
    const leftKnee = Number.isFinite(angles.leftKnee) ? angles.leftKnee : null;
    const rightKnee = Number.isFinite(angles.rightKnee) ? angles.rightKnee : null;
    const kneeSymmetry = leftKnee != null && rightKnee != null ? Math.abs(leftKnee - rightKnee) : null;
    const hasKneeTrackingProxy = angles.kneeAlignment &&
      Number.isFinite(angles.kneeAlignment.left) &&
      Number.isFinite(angles.kneeAlignment.right);
    const kneeAlignment = hasKneeTrackingProxy
      ? (Math.abs(angles.kneeAlignment.left) + Math.abs(angles.kneeAlignment.right)) / 2
      : null;
    const qualityScore = Number.isFinite(angles.quality?.score) ? angles.quality.score : null;

    const tibiaAngle = repCounter.getAngleValue(angles, 'tibia_angle');
    const trunkTibiaAngle = angles.trunkTibiaAngle != null
      ? angles.trunkTibiaAngle
      : (Number.isFinite(angles.spine) && Number.isFinite(angles.tibia)
         ? Math.abs(angles.spine - angles.tibia)
         : null);

      const heelContact = angles.heelContact != null
        ? (angles.heelContact ? 1 : 0)
        : (Number.isFinite(angles.heelY) && Number.isFinite(angles.toeY)
         ? (angles.heelY >= angles.toeY - 0.02 ? 1 : 0)
         : null);

      const hipBelowKnee = angles.hipBelowKnee != null
        ? (angles.hipBelowKnee ? 1 : 0)
        : (Number.isFinite(angles.hipY) && Number.isFinite(angles.kneeY)
         ? (angles.hipY > angles.kneeY ? 1 : 0)
         : null);

    const kneeValgus = angles.kneeValgus != null
      ? angles.kneeValgus
      : (hasKneeTrackingProxy
         ? (Math.abs(angles.kneeAlignment.left) + Math.abs(angles.kneeAlignment.right)) / 2
         : null);

    return {
      kneeAngle: primaryAngle,
      hipAngle: repCounter.getAngleValue(angles, 'hip_angle'),
      spineAngle: repCounter.getAngleValue(angles, 'spine_angle'),
      kneeSymmetry,
      kneeAlignment,
      qualityScore,
      view: angles.view || 'UNKNOWN',
      qualityLevel: angles.quality?.level || 'UNKNOWN',
      tibiaAngle,
      trunkTibiaAngle,
      heelContact,
      hipBelowKnee,
      kneeValgus
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
    repCounter.updateMetricStats(target.metrics.tibiaAngle, snapshot.tibiaAngle);
    repCounter.updateMetricStats(target.metrics.trunkTibiaAngle, snapshot.trunkTibiaAngle);
    repCounter.updateMetricStats(target.metrics.heelContact, snapshot.heelContact);
    repCounter.updateMetricStats(target.metrics.hipBelowKnee, snapshot.hipBelowKnee);
    repCounter.updateMetricStats(target.metrics.kneeValgus, snapshot.kneeValgus);
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
      },
      trunkTibia: {
        key: 'trunk_tibia_angle',
        title: '상체-다리 평행도',
        scorer: () => scoreTrunkTibia(values.maxTrunkTibia),
        rawValue: () => values.maxTrunkTibia,
        feedback: '상체와 다리가 평행하도록 자세를 유지해주세요'
      },
      heelContact: {
        key: 'heel_contact',
        title: '뒤꿈치 접지',
        scorer: () => scoreHeelContact(values.avgHeelContact),
        rawValue: () => values.avgHeelContact,
        feedback: '뒤꿈치가 떨어지지 않도록 유지해주세요'
      },
      kneeValgus: {
        key: 'knee_valgus',
        title: '무릎 안쪽 무너짐',
        scorer: () => scoreKneeValgus(values.avgKneeValgus),
        rawValue: () => values.avgKneeValgus,
        feedback: '무릎이 안쪽으로 무너지지 않도록 바깥쪽 힘으로 밀어주세요'
      }
    };

    const plans = {
      SIDE: [
        { ...common.depth, weight: 0.30 },
        { ...common.hip, weight: 0.22 },
        { ...common.spine, weight: 0.18 },
        { ...common.trunkTibia, weight: 0.18 },
        { ...common.heelContact, weight: 0.08 },
        { ...common.alignment, weight: 0.04 }
      ],
      FRONT: [
        { ...common.symmetry, weight: 0.30 },
        { ...common.kneeValgus, weight: 0.30 },
        { ...common.depth, weight: 0.25 },
        { ...common.spine, weight: 0.15 }
      ],
      UNKNOWN: [
        { ...common.depth, weight: 0.25 },
        { ...common.alignment, weight: 0.20 },
        { ...common.symmetry, weight: 0.15 },
        { ...common.spine, weight: 0.12 },
        { ...common.hip, weight: 0.10 },
        { ...common.trunkTibia, weight: 0.10 },
        { ...common.kneeValgus, weight: 0.08 }
      ]
    };

    return plans[['SIDE', 'FRONT'].includes(view) ? view : 'UNKNOWN'];
  }

  function scoreDepth(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 90) return 100;
    if (value <= 100) return interpolate(value, 90, 100, 100, 85);
    if (value <= 115) return interpolate(value, 100, 115, 85, 50);
    if (value <= 130) return interpolate(value, 115, 130, 50, 15);
    return 0;
  }

  function scoreHip(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 110) return 100;
    if (value <= 120) return interpolate(value, 110, 120, 100, 80);
    if (value <= 140) return interpolate(value, 120, 140, 80, 40);
    if (value <= 155) return interpolate(value, 140, 155, 40, 10);
    return 0;
  }

  function scoreSpine(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 15) return 100;
    if (value <= 30) return interpolate(value, 15, 30, 100, 70);
    if (value <= 45) return interpolate(value, 30, 45, 70, 35);
    if (value <= 60) return interpolate(value, 45, 60, 35, 5);
    return 0;
  }

  function scoreSymmetry(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 10) return 100;
    if (value <= 18) return interpolate(value, 10, 18, 100, 70);
    if (value <= 28) return interpolate(value, 18, 28, 70, 25);
    return 0;
  }

  function scoreAlignment(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 0.03) return 100;
    if (value <= 0.05) return interpolate(value, 0.03, 0.05, 100, 75);
    if (value <= 0.08) return interpolate(value, 0.05, 0.08, 75, 30);
    if (value <= 0.12) return interpolate(value, 0.08, 0.12, 30, 5);
    return 0;
  }

  function scoreTrunkTibia(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 10) return 100;
    if (value <= 20) return interpolate(value, 10, 20, 100, 70);
    if (value <= 35) return interpolate(value, 20, 35, 70, 30);
    if (value <= 50) return interpolate(value, 35, 50, 30, 5);
    return 0;
  }

  function scoreHeelContact(value) {
    if (!Number.isFinite(value)) return null;
    if (value >= 0.90) return 100;
    if (value >= 0.80) return interpolate(value, 0.80, 0.90, 75, 100);
    if (value >= 0.65) return interpolate(value, 0.65, 0.80, 45, 75);
    if (value >= 0.50) return interpolate(value, 0.50, 0.65, 15, 45);
    return 0;
  }

  function scoreKneeValgus(value) {
    if (!Number.isFinite(value)) return null;
    if (value <= 0.03) return 100;
    if (value <= 0.06) return interpolate(value, 0.03, 0.06, 100, 70);
    if (value <= 0.10) return interpolate(value, 0.06, 0.10, 70, 30);
    if (value <= 0.15) return interpolate(value, 0.10, 0.15, 30, 5);
    return 0;
  }

  function interpolate(value, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) return outMax;
    const ratio = (value - inMin) / (inMax - inMin);
    return outMin + ((outMax - outMin) * ratio);
  }

  function pickFeedback({ hardFails, breakdown, view, confidence, bottomHip, maxSpine, maxTrunkTibia, avgHeelContact, avgKneeValgus }) {
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
    if (view === 'SIDE' && Number.isFinite(maxTrunkTibia) && maxTrunkTibia > 25) {
      return '상체와 다리가 평행하도록 자세를 유지해주세요';
    }
    if (view === 'SIDE' && Number.isFinite(avgHeelContact) && avgHeelContact < 0.7) {
      return '뒤꿈치가 떨어지지 않도록 유지해주세요';
    }
    if (view === 'FRONT' && Number.isFinite(avgKneeValgus) && avgKneeValgus > 0.08) {
      return '무릎이 안쪽으로 물어지지 않도록 바깥쪽 힘으로 밀어주세요';
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
    if (view === 'FRONT' && metricKey === 'knee_alignment') return false;
    if (metricKey === 'heel_contact') {
      return view === 'SIDE' &&
        (phase === REP_PHASES.BOTTOM || phase === REP_PHASES.ASCENT);
    }

    // 상체는 모든 phase에서 평가
    if (category === 'torso') {
      return true;
    }

    // 무릎 정렬은 실제 동작 중(DESCENT, BOTTOM, ASCENT)에서만 평가
    if (category === 'alignment') {
      return phase === REP_PHASES.DESCENT ||
             phase === REP_PHASES.BOTTOM ||
             phase === REP_PHASES.ASCENT;
    }

    // 대칭은 최저점(BOTTOM)과 올라오는 구간(ASCENT)에서만 평가
    if (category === 'symmetry') {
      return phase === REP_PHASES.BOTTOM || phase === REP_PHASES.ASCENT;
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

    if (key.includes('spine') || key.includes('torso') || key.includes('back') || key.includes('trunk_tibia') || key.includes('lumbar')) {
      return 'torso';
    }
    if (key.includes('hip')) {
      return 'hip';
    }
    if (key.includes('symmetry')) {
      return 'symmetry';
    }
    if (key === 'knee_alignment' || key === 'knee_over_toe' || key === 'heel_contact' || key === 'knee_valgus') {
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
