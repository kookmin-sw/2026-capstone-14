/**
 * exercise-registry.js
 *
 * 운동별 로직 모듈을 등록하고 조회하는 전역 레지스트리.
 * 각 운동 모듈(squat-exercise.js, push-up-exercise.js, plank-exercise.js 등)은
 * 로드 시 자신을 이 레지스트리에 등록합니다.
 * RepCounter, ScoringEngine 등에서 운동 코드로 모듈을 조회하여 사용합니다.
 */
(function initWorkoutExerciseRegistry() {
  const existing = window.WorkoutExerciseRegistry || {};
  const registry = existing.registry || Object.create(null);

  /** 운동 코드를 정규화합니다 (소문자, 하이픈→언더스코어). */
  function normalizeExerciseCode(code) {
    return (code || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/-/g, '_');
  }

  /**
   * 운동 모듈을 레지스트리에 등록합니다.
   * @param {string} code - 운동 코드 (예: 'squat', 'push_up')
   * @param {Object} exerciseModule - 운동 로직 모듈
   */
  function register(code, exerciseModule) {
    const normalized = normalizeExerciseCode(code);
    if (!normalized || !exerciseModule) return;
    registry[normalized] = exerciseModule;
  }

  /**
   * 운동 코드로 등록된 모듈을 조회합니다.
   * @param {string} code - 운동 코드
   * @returns {Object|null} 운동 모듈 또는 null
   */
  function get(code) {
    const normalized = normalizeExerciseCode(code);
    return normalized ? registry[normalized] || null : null;
  }

  window.WorkoutExerciseRegistry = {
    registry,
    normalizeExerciseCode,
    register,
    get,
    /** 운동 코드가 레지스트리에 등록되어 있는지 확인합니다. */
    has(code) {
      return Boolean(get(code));
    }
  };
})();
