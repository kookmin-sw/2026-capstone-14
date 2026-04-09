/**
 * 운동별 로직 registry
 */
(function initWorkoutExerciseRegistry() {
  const existing = window.WorkoutExerciseRegistry || {};
  const registry = existing.registry || Object.create(null);

  function normalizeExerciseCode(code) {
    return (code || '')
      .toString()
      .trim()
      .toLowerCase()
      .replace(/-/g, '_');
  }

  function register(code, exerciseModule) {
    const normalized = normalizeExerciseCode(code);
    if (!normalized || !exerciseModule) return;
    registry[normalized] = exerciseModule;
  }

  function get(code) {
    const normalized = normalizeExerciseCode(code);
    return normalized ? registry[normalized] || null : null;
  }

  window.WorkoutExerciseRegistry = {
    registry,
    normalizeExerciseCode,
    register,
    get,
    has(code) {
      return Boolean(get(code));
    }
  };
})();
