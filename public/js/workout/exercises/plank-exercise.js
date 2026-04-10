/* EXERCISE_MANIFEST
{
  "code": "PLANK",
  "name": "플랭크",
  "description": "코어 안정성과 자세 유지 능력을 평가하는 시간 기반 운동",
  "default_target_type": "TIME",
  "allowed_views": ["SIDE"],
  "default_view": "SIDE",
  "sort_order": 30,
  "is_active": false
}
*/
/**
 * 플랭크 전용 자세 게이트/시간 기반 점수 보조
 */
(function registerPlankExerciseModule() {
  const registry = window.WorkoutExerciseRegistry;
  if (!registry) return;

  const plankExercise = {
    code: 'plank',

    getDefaultProfileMetrics() {
      return [
        {
          weight: 0.3,
          max_score: 30,
          rule: {
            ideal_min: 150,
            ideal_max: 180,
            acceptable_min: 130,
            acceptable_max: 180,
            feedback_low: '골반이 처지지 않게 머리부터 발끝까지 일직선을 유지해주세요'
          },
          metric: {
            metric_id: 'plank_body_line',
            key: 'hip_angle',
            title: '몸통 일직선',
            unit: 'DEG'
          }
        },
        {
          weight: 0.25,
          max_score: 25,
          rule: {
            ideal_min: 70,
            ideal_max: 105,
            acceptable_min: 55,
            acceptable_max: 120,
            feedback_low: '상체가 너무 들리지 않게 몸통을 바닥과 평행하게 맞춰주세요',
            feedback_high: '허리가 꺾이지 않도록 코어에 힘을 주세요'
          },
          metric: {
            metric_id: 'plank_spine_stability',
            key: 'spine_angle',
            title: '몸통 수평 유지',
            unit: 'DEG'
          }
        },
        {
          weight: 0.15,
          max_score: 15,
          rule: {
            ideal_min: 55,
            ideal_max: 105,
            acceptable_min: 40,
            acceptable_max: 125,
            feedback_low: '어깨가 팔 지지선 위에 오도록 위치를 다시 맞춰주세요',
            feedback_high: '어깨가 너무 앞으로 나가지 않게 팔과 수직에 가깝게 맞춰주세요'
          },
          metric: {
            metric_id: 'plank_shoulder_stack',
            key: 'shoulder_angle',
            title: '어깨 지지 정렬',
            unit: 'DEG'
          }
        },
        {
          weight: 0.15,
          max_score: 15,
          rule: {
            type: 'threshold',
            value: 60,
            direction: 'gte',
            feedback_low: '팔꿈치가 몸 아래로 너무 말리지 않게 전완과 상완 각도를 조금 더 열어주세요'
          },
          metric: {
            metric_id: 'plank_elbow_support',
            key: 'elbow_support_angle',
            title: '팔 지지 각도',
            unit: 'DEG'
          }
        },
        {
          weight: 0.15,
          max_score: 15,
          rule: {
            ideal_min: 160,
            ideal_max: 180,
            acceptable_min: 145,
            acceptable_max: 180,
            feedback_low: '무릎을 굽히지 말고 다리를 길게 펴서 버텨주세요'
          },
          metric: {
            metric_id: 'plank_leg_extension',
            key: 'knee_angle',
            title: '다리 펴기',
            unit: 'DEG'
          }
        }
      ];
    },

    getFrameGate(angles, runtime) {
      const quality = angles?.quality || {};
      const view = angles?.view || 'UNKNOWN';
      const selectedView = runtime?.selectedView || runtime?.state?.selectedView || null;
      const trackedJointRatio = quality.trackedJointRatio ?? 0;
      const inFrameRatio = quality.inFrameRatio ?? 0;
      const score = quality.score ?? 0;
      const hipAngle = runtime?.repCounter?.getAngleValue ? runtime.repCounter.getAngleValue(angles, 'hip_angle') : null;
      const spineAngle = runtime?.repCounter?.getAngleValue ? runtime.repCounter.getAngleValue(angles, 'spine_angle') : null;
      const kneeAngle = runtime?.repCounter?.getAngleValue ? runtime.repCounter.getAngleValue(angles, 'knee_angle') : null;

      if (!Number.isFinite(hipAngle) || !Number.isFinite(spineAngle) || !Number.isFinite(kneeAngle)) {
        return {
          isReady: false,
          reason: 'joints_missing',
          message: '어깨, 골반, 무릎, 발목이 모두 보이도록 카메라를 맞춰주세요'
        };
      }

      if (trackedJointRatio < 0.7) {
        return {
          isReady: false,
          reason: 'tracked_joints_low',
          message: '전신이 잘 보이도록 카메라를 조금 더 멀리 두세요'
        };
      }

      if (inFrameRatio < 0.72) {
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
          message: '플랭크는 측면 자세에서만 채점합니다. 몸을 옆으로 돌려주세요'
        };
      }

      if (selectedView && view !== selectedView) {
        return {
          isReady: false,
          reason: 'view_mismatch',
          message: '플랭크는 측면 자세에서만 채점합니다. 몸을 측면으로 유지해주세요'
        };
      }

      if (score < 0.55) {
        return {
          isReady: false,
          reason: 'quality_low',
          message: '카메라 위치와 조명을 조정하고 다시 자세를 잡아주세요'
        };
      }

      return { isReady: true };
    },

    filterLiveFeedback(scoreResult) {
      if (!scoreResult?.breakdown?.length) {
        return scoreResult;
      }

      const normalizedScore = calculateNormalizedLiveScore(scoreResult.breakdown);
      const prioritized = scoreResult.breakdown
        .slice()
        .sort((a, b) => {
          const left = (a.score || 0) / (a.maxScore || 1);
          const right = (b.score || 0) / (b.maxScore || 1);
          return left - right;
        })
        .slice(0, 3);

      return {
        ...scoreResult,
        score: normalizedScore,
        breakdown: prioritized
      };
    }
  };

  function calculateNormalizedLiveScore(breakdown) {
    let scoreSum = 0;
    let maxScoreSum = 0;

    for (const item of breakdown || []) {
      const score = Number(item?.score);
      const maxScore = Number(item?.maxScore);
      if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0) {
        continue;
      }

      scoreSum += Math.max(0, Math.min(maxScore, score));
      maxScoreSum += maxScore;
    }

    if (maxScoreSum <= 0) return 0;
    return Math.max(0, Math.min(100, Math.round((scoreSum / maxScoreSum) * 100)));
  }

  registry.register('plank', plankExercise);
})();
