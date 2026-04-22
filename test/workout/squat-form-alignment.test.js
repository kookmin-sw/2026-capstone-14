const test = require('node:test');
const assert = require('node:assert/strict');

if (typeof window === 'undefined') {
  global.window = {};
}

if (!window.WorkoutExerciseRegistry) {
  window.WorkoutExerciseRegistry = {
    _modules: {},
    register(code, mod) { this._modules[code] = mod; },
    get(code) { return this._modules[code] || null; },
  };
}

require('../../public/js/workout/exercises/squat-exercise.js');
require('../../public/js/workout/rep-counter.js');

const { PoseEngine, LANDMARKS } = require('../../public/js/workout/pose-engine.js');

function createLandmarks(overrides = {}) {
  const landmarks = new Array(33).fill(null).map(() => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility: 0.99,
  }));

  const defaults = {
    [LANDMARKS.LEFT_SHOULDER]: { x: 0.42, y: 0.35 },
    [LANDMARKS.RIGHT_SHOULDER]: { x: 0.58, y: 0.35 },
    [LANDMARKS.LEFT_HIP]: { x: 0.45, y: 0.80 },
    [LANDMARKS.RIGHT_HIP]: { x: 0.55, y: 0.80 },
    [LANDMARKS.LEFT_KNEE]: { x: 0.46, y: 0.68 },
    [LANDMARKS.RIGHT_KNEE]: { x: 0.54, y: 0.68 },
    [LANDMARKS.LEFT_ANKLE]: { x: 0.47, y: 0.90 },
    [LANDMARKS.RIGHT_ANKLE]: { x: 0.53, y: 0.90 },
    [LANDMARKS.LEFT_HEEL]: { x: 0.45, y: 0.95 },
    [LANDMARKS.RIGHT_HEEL]: { x: 0.55, y: 0.95 },
    [LANDMARKS.LEFT_FOOT_INDEX]: { x: 0.49, y: 0.94 },
    [LANDMARKS.RIGHT_FOOT_INDEX]: { x: 0.59, y: 0.94 },
  };

  Object.entries(defaults).forEach(([index, point]) => {
    Object.assign(landmarks[Number(index)], point);
  });

  Object.entries(overrides).forEach(([index, point]) => {
    Object.assign(landmarks[Number(index)], point);
  });

  return landmarks;
}

test('PoseEngine.calculateAllAngles emits squat support signals', () => {
  const engine = new PoseEngine();
  const landmarks = createLandmarks();
  const angles = engine.calculateAllAngles(landmarks);

  assert.ok(Number.isFinite(angles.tibia), 'tibia must be computed');
  assert.ok(Number.isFinite(angles.trunkTibiaAngle), 'trunkTibiaAngle must be computed');
  assert.equal(angles.heelContact, true, 'heelContact must be true when heels stay down');
  assert.equal(angles.hipBelowKnee, true, 'hipBelowKnee must detect parallel-or-below depth');
  assert.ok(Number.isFinite(angles.kneeAlignment.left), 'kneeAlignment.left must be finite');
  assert.ok(Number.isFinite(angles.kneeAlignment.right), 'kneeAlignment.right must be finite');
});

test('PoseEngine.getHeelContact detects raised heel', () => {
  const engine = new PoseEngine();
  const landmarks = createLandmarks({
    [LANDMARKS.LEFT_HEEL]: { y: 0.86 },
  });

  assert.equal(engine.getHeelContact(landmarks), false);
});

test('squat module removes lumbar metric from active default profile', () => {
  const squatModule = window.WorkoutExerciseRegistry.get('squat');
  assert.ok(squatModule, 'squat module must be registered');

  const metricKeys = squatModule.getDefaultProfileMetrics().map((item) => item.metric.key);
  assert.equal(metricKeys.includes('lumbar_angle'), false);
});

test('squat module no longer exposes getFrameGate', () => {
  const squatModule = window.WorkoutExerciseRegistry.get('squat');
  assert.ok(squatModule, 'squat module must be registered');
  assert.equal(typeof squatModule.getFrameGate, 'undefined');
});

test('RepCounter metric stats accumulate boolean squat signals', () => {
  const repCounter = new window.RepCounter('squat');
  const stats = repCounter.createMetricStats();

  repCounter.updateMetricStats(stats, true);
  repCounter.updateMetricStats(stats, false);
  repCounter.updateMetricStats(stats, true);

  assert.deepEqual(repCounter.finalizeMetricStats(stats), {
    min: 0,
    max: 1,
    avg: 0.7,
    count: 3,
  });
});

test('squat live feedback removes heel contact cue for front view', () => {
  const squatModule = window.WorkoutExerciseRegistry.get('squat');
  const filtered = squatModule.filterLiveFeedback({
    score: 82,
    breakdown: [
      { key: 'heel_contact', title: '뒤꿈치 접지', score: 0, maxScore: 10, feedback: '뒤꿈치가 떨어지지 않도록 유지해주세요' },
      { key: 'depth', title: '스쿼트 깊이', score: 8, maxScore: 10, feedback: null },
    ],
  }, {
    repCounter: {
      currentPhase: window.REP_PHASES.BOTTOM,
      currentState: window.REP_STATES.ACTIVE,
    },
    angles: {
      view: 'FRONT',
    },
  });

  assert.deepEqual(filtered.breakdown.map((item) => item.key), ['depth']);
});

test('squat live feedback removes knee alignment cue for front view', () => {
  const squatModule = window.WorkoutExerciseRegistry.get('squat');
  const filtered = squatModule.filterLiveFeedback({
    score: 82,
    breakdown: [
      { key: 'knee_alignment', title: '무릎 정렬', score: 4, maxScore: 10, feedback: '무릎이 발끝 방향을 유지하도록 해주세요' },
      { key: 'knee_valgus', title: '무릎 안쪽 무너짐', score: 4, maxScore: 10, feedback: '무릎이 안쪽으로 무너지지 않도록 바깥쪽 힘으로 밀어주세요' },
      { key: 'depth', title: '스쿼트 깊이', score: 8, maxScore: 10, feedback: null },
    ],
  }, {
    repCounter: {
      currentPhase: window.REP_PHASES.BOTTOM,
      currentState: window.REP_STATES.ACTIVE,
    },
    angles: {
      view: 'FRONT',
    },
  });

  assert.deepEqual(filtered.breakdown.map((item) => item.key), ['knee_valgus', 'depth']);
});

test('squat rep scoring uses averaged heel contact instead of single-frame min', () => {
  const squatModule = window.WorkoutExerciseRegistry.get('squat');
  const scoringEngine = {
    pickMetric(summary, phases, metricKey, statKey) {
      return summary.metricStats?.[metricKey]?.[statKey] ?? null;
    },
    pickPhaseMetric(summary, phases, metricKey, statKey) {
      return summary.metricStats?.[metricKey]?.[statKey] ?? null;
    },
    getProfileMetricConfig(metricKey, fallbackTitle) {
      return {
        metric_id: metricKey,
        title: fallbackTitle,
      };
    },
  };

  const repRecord = {
    repNumber: 1,
    selectedView: 'SIDE',
    score: 80,
    summary: {
      dominantView: 'SIDE',
      confidence: { score: 0.9, level: 'HIGH', factor: 1 },
      flags: { bottomReached: true, lockoutReached: true },
      metricStats: {
        kneeAngle: { min: 90, max: 170 },
        hipAngle: { min: 100 },
        spineAngle: { max: 12 },
        kneeSymmetry: { avg: 2 },
        kneeAlignment: { avg: 0.02 },
        trunkTibiaAngle: { max: 8 },
        heelContact: { min: 0, avg: 0.8 },
        hipBelowKnee: { min: 1 },
        kneeValgus: { avg: 0.02 },
      },
    },
  };

  const scored = squatModule.scoreRep(scoringEngine, repRecord);
  const heelBreakdown = scored.breakdown.find((item) => item.key === 'heel_contact');

  assert.ok(heelBreakdown, 'heel_contact must be part of side-view scoring');
  assert.ok(heelBreakdown.normalizedScore >= 75, 'averaged heel contact should not collapse to zero');
  assert.notEqual(scored.feedback, '뒤꿈치가 떨어지지 않도록 유지해주세요');
});

test('squat rep scoring does not cap to 55 when depth angle is sufficient but bottomReached flag is false', () => {
  const squatModule = window.WorkoutExerciseRegistry.get('squat');
  const scoringEngine = {
    pickMetric(summary, phases, metricKey, statKey) {
      return summary.metricStats?.[metricKey]?.[statKey] ?? null;
    },
    pickPhaseMetric(summary, phases, metricKey, statKey) {
      return summary.metricStats?.[metricKey]?.[statKey] ?? null;
    },
    getProfileMetricConfig(metricKey, fallbackTitle) {
      return {
        metric_id: metricKey,
        title: fallbackTitle,
      };
    },
  };

  const repRecord = {
    repNumber: 1,
    selectedView: 'SIDE',
    score: 84,
    summary: {
      dominantView: 'SIDE',
      confidence: { score: 0.92, level: 'HIGH', factor: 1 },
      flags: { bottomReached: false, lockoutReached: true },
      metricStats: {
        kneeAngle: { min: 118, max: 170 },
        hipAngle: { min: 108 },
        spineAngle: { max: 16 },
        kneeSymmetry: { avg: 3 },
        kneeAlignment: { avg: 0.02 },
        trunkTibiaAngle: { max: 12 },
        heelContact: { avg: 0.9 },
        hipBelowKnee: { min: 0 },
        kneeValgus: { avg: 0.02 },
      },
    },
  };

  const scored = squatModule.scoreRep(scoringEngine, repRecord);

  assert.ok(scored.score > 55, 'depth-adequate rep must not be capped to 55');
  assert.equal(scored.hardFails.includes('depth_not_reached'), false);
});

test('squat rep scoring still caps clearly shallow reps to 55', () => {
  const squatModule = window.WorkoutExerciseRegistry.get('squat');
  const scoringEngine = {
    pickMetric(summary, phases, metricKey, statKey) {
      return summary.metricStats?.[metricKey]?.[statKey] ?? null;
    },
    pickPhaseMetric(summary, phases, metricKey, statKey) {
      return summary.metricStats?.[metricKey]?.[statKey] ?? null;
    },
    getProfileMetricConfig(metricKey, fallbackTitle) {
      return {
        metric_id: metricKey,
        title: fallbackTitle,
      };
    },
  };

  const repRecord = {
    repNumber: 1,
    selectedView: 'SIDE',
    score: 84,
    summary: {
      dominantView: 'SIDE',
      confidence: { score: 0.92, level: 'HIGH', factor: 1 },
      flags: { bottomReached: false, lockoutReached: true },
      metricStats: {
        kneeAngle: { min: 142, max: 170 },
        hipAngle: { min: 130 },
        spineAngle: { max: 18 },
        kneeSymmetry: { avg: 3 },
        kneeAlignment: { avg: 0.02 },
        trunkTibiaAngle: { max: 14 },
        heelContact: { avg: 0.9 },
        hipBelowKnee: { min: 0 },
        kneeValgus: { avg: 0.02 },
      },
    },
  };

  const scored = squatModule.scoreRep(scoringEngine, repRecord);

  assert.equal(scored.hardFails.includes('depth_not_reached'), true);
  assert.equal(scored.score, 55);
});

test('squat front-view rep scoring excludes knee alignment from weighted breakdown', () => {
  const squatModule = window.WorkoutExerciseRegistry.get('squat');
  const scoringEngine = {
    pickMetric(summary, phases, metricKey, statKey) {
      return summary.metricStats?.[metricKey]?.[statKey] ?? null;
    },
    pickPhaseMetric(summary, phases, metricKey, statKey) {
      return summary.metricStats?.[metricKey]?.[statKey] ?? null;
    },
    getProfileMetricConfig(metricKey, fallbackTitle) {
      return {
        metric_id: metricKey,
        title: fallbackTitle,
      };
    },
  };

  const repRecord = {
    repNumber: 1,
    selectedView: 'FRONT',
    score: 86,
    summary: {
      dominantView: 'FRONT',
      confidence: { score: 0.95, level: 'HIGH', factor: 1 },
      flags: { bottomReached: true, lockoutReached: true },
      metricStats: {
        kneeAngle: { min: 102, max: 170 },
        hipAngle: { min: 110 },
        spineAngle: { max: 10 },
        kneeSymmetry: { avg: 4 },
        kneeAlignment: { avg: 0.09 },
        trunkTibiaAngle: { max: 12 },
        heelContact: { avg: 0.9 },
        hipBelowKnee: { min: 1 },
        kneeValgus: { avg: 0.02 },
      },
    },
  };

  const scored = squatModule.scoreRep(scoringEngine, repRecord);

  assert.equal(scored.view, 'FRONT');
  assert.equal(scored.breakdown.some((item) => item.key === 'knee_alignment'), false);
  assert.equal(scored.breakdown.some((item) => item.key === 'knee_valgus'), true);
});
