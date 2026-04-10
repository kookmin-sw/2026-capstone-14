const { supabase } = require('../config/db');
const { syncExerciseCatalog } = require('../config/exerciseCatalog');
const { updateQuestProgress } = require('./quest');

const SESSION_STALE_HOURS = 12;
const VIEW_CODES = ['FRONT', 'SIDE', 'DIAGONAL'];
const MODE_CODES = ['FREE', 'ROUTINE', 'LEARN'];
const RESULT_BASIS_CODES = ['REPS', 'DURATION'];
const RESULT_UNIT_CODES = ['COUNT', 'SEC'];

const createApiError = (statusCode, message) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const sendApiError = (res, error, fallbackMessage = '요청 처리 중 오류가 발생했습니다.') => {
    const statusCode = error?.statusCode || 500;
    return res.status(statusCode).json({
        success: false,
        error: error?.message || fallbackMessage
    });
};

const normalizeExerciseCode = (code) =>
    String(code || '')
        .trim()
        .toLowerCase()
        .replace(/-/g, '_');

const EXERCISE_VIEW_FALLBACKS = {
    push_up: {
        allowed_views: ['SIDE'],
        default_view: 'SIDE'
    },
    pushup: {
        allowed_views: ['SIDE'],
        default_view: 'SIDE'
    }
};

const EXERCISE_MODULE_SCRIPT_ALIASES = {
    push_up: 'push-up-exercise.js',
    pushup: 'push-up-exercise.js'
};

const sanitizeCodeForScript = (code) =>
    String(code || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');

const toNullableNonNegativeInt = (value) => {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.round(parsed));
};

const toBoundedScore = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(100, Math.round(parsed * 100) / 100));
};

const normalizeMode = (value) => {
    const mode = String(value || 'FREE').trim().toUpperCase();
    return MODE_CODES.includes(mode) ? mode : 'FREE';
};

const normalizeResultBasis = (value) => {
    const basis = String(value || '').trim().toUpperCase();
    return RESULT_BASIS_CODES.includes(basis) ? basis : null;
};

const normalizeResultUnit = (value) => {
    const unit = String(value || '').trim().toUpperCase();
    return RESULT_UNIT_CODES.includes(unit) ? unit : null;
};

const normalizeSelectedView = (value) => {
    const selected = String(value || '').trim().toUpperCase();
    return VIEW_CODES.includes(selected) ? selected : null;
};

const toSafeText = (value, maxLength = 2000) => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed ? trimmed.slice(0, maxLength) : null;
};

const computeDurationSecFromRange = (startedAtIso, endedAtIso = new Date().toISOString()) => {
    const startMs = new Date(startedAtIso).getTime();
    const endMs = new Date(endedAtIso).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
    return Math.max(0, Math.round((endMs - startMs) / 1000));
};

const dedupeAndOrderViews = (viewRows = []) => {
    const unique = new Set();
    const ordered = [];

    for (const code of VIEW_CODES) {
        if (viewRows.some((row) => row?.view_code === code)) {
            unique.add(code);
            ordered.push(code);
        }
    }

    for (const row of viewRows) {
        const code = row?.view_code;
        if (!code || unique.has(code)) continue;
        unique.add(code);
        ordered.push(code);
    }

    return ordered;
};

const buildAllowedViewInfo = (viewRows = []) => {
    const allowedViews = dedupeAndOrderViews(viewRows);
    const defaultView =
        viewRows.find((row) => row?.is_default)?.view_code ||
        allowedViews[0] ||
        'FRONT';

    return {
        allowed_views: allowedViews.length > 0 ? allowedViews : ['FRONT'],
        default_view: allowedViews.includes(defaultView) ? defaultView : (allowedViews[0] || 'FRONT')
    };
};

const getExerciseViewFallback = (exerciseCode) => {
    const normalizedCode = normalizeExerciseCode(exerciseCode);
    return EXERCISE_VIEW_FALLBACKS[normalizedCode] || null;
};

const attachAllowedViewInfo = (exercise, viewRows = []) => {
    const fallback = getExerciseViewFallback(exercise?.code);

    return {
        ...exercise,
        ...(fallback || buildAllowedViewInfo(viewRows))
    };
};

const getExerciseModuleScriptName = (exerciseCode) => {
    const normalizedCode = normalizeExerciseCode(exerciseCode);
    return EXERCISE_MODULE_SCRIPT_ALIASES[normalizedCode] || `${sanitizeCodeForScript(exerciseCode).replace(/_/g, '-')}-exercise.js`;
};

const getAllowedViewMapByExerciseIds = async (exerciseIds) => {
    if (!Array.isArray(exerciseIds) || exerciseIds.length === 0) return new Map();

    const { data: viewRows, error } = await supabase
        .from('exercise_allowed_view')
        .select('exercise_id, view_code, is_default')
        .in('exercise_id', exerciseIds);

    if (error) {
        throw createApiError(500, '허용 자세 정보를 불러오지 못했습니다.');
    }

    const map = new Map();
    for (const row of viewRows || []) {
        if (!map.has(row.exercise_id)) {
            map.set(row.exercise_id, []);
        }
        map.get(row.exercise_id).push(row);
    }

    return map;
};

const getExerciseByCodeWithViews = async (exerciseCode) => {
    const normalizedCode = String(exerciseCode || '').trim();
    if (!normalizedCode) return null;

    let exercise = null;
    const { data: exactMatch } = await supabase
        .from('exercise')
        .select('exercise_id, code, name, description, is_active, default_target_type')
        .eq('code', normalizedCode)
        .maybeSingle();

    if (exactMatch?.is_active) {
        exercise = exactMatch;
    } else {
        const { data: ilikeMatch } = await supabase
            .from('exercise')
            .select('exercise_id, code, name, description, is_active, default_target_type')
            .ilike('code', normalizedCode)
            .maybeSingle();
        if (ilikeMatch?.is_active) {
            exercise = ilikeMatch;
        }
    }

    if (!exercise) return null;

    const viewMap = await getAllowedViewMapByExerciseIds([exercise.exercise_id]);
    return attachAllowedViewInfo(exercise, viewMap.get(exercise.exercise_id) || []);
};

const getExerciseByIdWithViews = async (exerciseId) => {
    const { data: exercise, error } = await supabase
        .from('exercise')
        .select('exercise_id, code, name, description, is_active, default_target_type')
        .eq('exercise_id', exerciseId)
        .single();

    if (error || !exercise || !exercise.is_active) {
        return null;
    }

    const viewMap = await getAllowedViewMapByExerciseIds([exercise.exercise_id]);
    return attachAllowedViewInfo(exercise, viewMap.get(exercise.exercise_id) || []);
};

const getRuntimeScoringProfile = (exerciseCode) => {
    const code = normalizeExerciseCode(exerciseCode);
    return {
        scoring_profile_id: null,
        source: 'RUNTIME_JS',
        exercise_code: code,
        scoring_profile_metric: []
    };
};

const getRoutineWithSteps = async (routineId, userId) => {
    const { data: routine, error } = await supabase
        .from('routine')
        .select(`
            routine_id,
            name,
            is_active,
            routine_setup (
                step_id,
                order_no,
                target_type,
                target_value,
                rest_sec,
                sets,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name,
                    description,
                    default_target_type,
                    is_active
                )
            )
        `)
        .eq('routine_id', routineId)
        .eq('user_id', userId)
        .eq('is_active', true)
        .single();

    if (error || !routine) {
        throw createApiError(404, '루틴을 찾을 수 없습니다.');
    }

    routine.routine_setup = (routine.routine_setup || []).sort(
        (a, b) => (a.order_no || 0) - (b.order_no || 0)
    );

    if (routine.routine_setup.length === 0) {
        throw createApiError(400, '루틴에 운동 단계가 없습니다.');
    }

    const exerciseIds = [...new Set(
        routine.routine_setup
            .map((step) => step.exercise?.exercise_id)
            .filter(Boolean)
    )];

    const viewMap = await getAllowedViewMapByExerciseIds(exerciseIds);

    routine.routine_setup = routine.routine_setup.map((step) => {
        const exercise = step.exercise || null;
        const attachedExercise = exercise
            ? attachAllowedViewInfo(exercise, viewMap.get(exercise.exercise_id) || [])
            : null;

        return {
            ...step,
            exercise: attachedExercise,
            scoring_profile: getRuntimeScoringProfile(exercise?.code)
        };
    });

    return routine;
};

const normalizeTargetType = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'DURATION') return 'TIME';
    return normalized === 'TIME' ? 'TIME' : 'REPS';
};

const getResultUnitByTargetType = (targetType) =>
    normalizeTargetType(targetType) === 'TIME' ? 'SEC' : 'COUNT';

const getResultBasisByTargetType = (targetType) =>
    normalizeTargetType(targetType) === 'TIME' ? 'DURATION' : 'REPS';

const createRoutineStartContext = async (routine, userId) => {
    const steps = Array.isArray(routine?.routine_setup) ? routine.routine_setup : [];
    const firstStep = steps[0] || null;
    if (!firstStep?.step_id || !firstStep?.exercise?.exercise_id) {
        throw createApiError(400, '루틴 시작 데이터가 올바르지 않습니다.');
    }

    const nowIso = new Date().toISOString();
    let routineInstanceId = null;

    try {
        const { data: routineInstance, error: routineInstanceError } = await supabase
            .from('routine_instance')
            .insert({
                routine_id: routine.routine_id,
                user_id: userId,
                status: 'RUNNING',
                started_at: nowIso,
                updated_at: nowIso
            })
            .select('routine_instance_id, routine_id, user_id, status, started_at, ended_at')
            .single();

        if (routineInstanceError || !routineInstance) {
            throw routineInstanceError || new Error('Routine instance insert failed');
        }
        routineInstanceId = routineInstance.routine_instance_id;

        const stepRows = steps.map((step, index) => {
            const targetType = normalizeTargetType(step.target_type);
            return {
                routine_instance_id: routineInstance.routine_instance_id,
                step_id: step.step_id,
                exercise_id: step.exercise?.exercise_id,
                order_no: Math.max(1, toNullableNonNegativeInt(step.order_no) || (index + 1)),
                target_type_snapshot: targetType,
                target_value_snapshot: Math.max(1, toNullableNonNegativeInt(step.target_value) || 1),
                planned_sets: Math.max(1, toNullableNonNegativeInt(step.sets) || 1),
                completed_sets: 0,
                status: index === 0 ? 'RUNNING' : 'PENDING',
                started_at: index === 0 ? nowIso : null,
                updated_at: nowIso
            };
        });

        const { data: insertedStepInstances, error: stepInsertError } = await supabase
            .from('routine_step_instance')
            .insert(stepRows)
            .select(`
                step_instance_id,
                routine_instance_id,
                step_id,
                exercise_id,
                order_no,
                target_type_snapshot,
                target_value_snapshot,
                planned_sets,
                completed_sets,
                status
            `);

        if (stepInsertError || !Array.isArray(insertedStepInstances) || insertedStepInstances.length === 0) {
            throw stepInsertError || new Error('Routine step instances insert failed');
        }

        const orderedStepInstances = [...insertedStepInstances].sort(
            (a, b) => (a.order_no || 0) - (b.order_no || 0)
        );

        const firstStepInstance = orderedStepInstances[0];
        const restSec = Math.max(0, toNullableNonNegativeInt(firstStep.rest_sec) || 0);

        const { data: workoutSet, error: workoutSetError } = await supabase
            .from('workout_set')
            .insert({
                step_instance_id: firstStepInstance.step_instance_id,
                set_no: 1,
                target_type: firstStepInstance.target_type_snapshot,
                target_value: firstStepInstance.target_value_snapshot,
                value_unit: getResultUnitByTargetType(firstStepInstance.target_type_snapshot),
                result_basis: getResultBasisByTargetType(firstStepInstance.target_type_snapshot),
                rest_sec_after: restSec,
                status: 'RUNNING',
                started_at: nowIso,
                updated_at: nowIso
            })
            .select('set_id, step_instance_id, set_no, target_type, target_value, status')
            .single();

        if (workoutSetError || !workoutSet) {
            throw workoutSetError || new Error('Workout set insert failed');
        }

        return {
            set_id: workoutSet.set_id,
            exercise: firstStep.exercise,
            routine_instance: routineInstance,
            step_instance: firstStepInstance,
            workout_set: workoutSet
        };
    } catch (error) {
        if (routineInstanceId) {
            await supabase
                .from('routine_instance')
                .delete()
                .eq('routine_instance_id', routineInstanceId);
        }
        throw createApiError(500, '루틴 시작 컨텍스트 생성에 실패했습니다.');
    }
};

const loadRoutineExecutionBySetId = async (setId) => {
    if (!Number.isFinite(Number(setId))) return null;

    const { data: workoutSet, error: workoutSetError } = await supabase
        .from('workout_set')
        .select('set_id, step_instance_id, set_no, target_type, target_value, started_at, status')
        .eq('set_id', setId)
        .maybeSingle();
    if (workoutSetError) throw workoutSetError;
    if (!workoutSet?.step_instance_id) return null;

    const { data: stepInstance, error: stepError } = await supabase
        .from('routine_step_instance')
        .select(`
            step_instance_id,
            routine_instance_id,
            step_id,
            exercise_id,
            order_no,
            target_type_snapshot,
            target_value_snapshot,
            planned_sets,
            completed_sets,
            status,
            started_at,
            ended_at
        `)
        .eq('step_instance_id', workoutSet.step_instance_id)
        .maybeSingle();
    if (stepError) throw stepError;
    if (!stepInstance?.routine_instance_id) {
        return { workoutSet, stepInstance: null, routineInstance: null };
    }

    const { data: routineInstance, error: routineError } = await supabase
        .from('routine_instance')
        .select('routine_instance_id, routine_id, user_id, status')
        .eq('routine_instance_id', stepInstance.routine_instance_id)
        .maybeSingle();
    if (routineError) throw routineError;

    return {
        workoutSet,
        stepInstance,
        routineInstance: routineInstance || null
    };
};

const syncRoutineExecutionFromSession = async ({
    session,
    userId,
    status,
    endedAtIso,
    finalScore = null,
    resultFields = null,
    completedSets = null
}) => {
    if (session?.mode !== 'ROUTINE' || !session?.set_id) return;

    const context = await loadRoutineExecutionBySetId(session.set_id);
    if (!context?.routineInstance || context.routineInstance.user_id !== userId) return;

    const normalizedFinalScore = Number.isFinite(Number(finalScore))
        ? toBoundedScore(finalScore, 0)
        : null;
    const targetType = normalizeTargetType(
        context.workoutSet?.target_type || context.stepInstance?.target_type_snapshot
    );
    const routineInstanceId = context.routineInstance.routine_instance_id;
    const stepInstanceId = context.stepInstance?.step_instance_id;

    if (status === 'ABORTED') {
        if (context.routineInstance.status === 'DONE') return;

        if (context.workoutSet?.status === 'RUNNING') {
            const { error: abortSetError } = await supabase
                .from('workout_set')
                .update({
                    status: 'ABORTED',
                    ended_at: endedAtIso,
                    updated_at: endedAtIso
                })
                .eq('set_id', session.set_id)
                .eq('status', 'RUNNING');
            if (abortSetError) throw abortSetError;
        }

        if (stepInstanceId && context.stepInstance?.status !== 'DONE') {
            const { error: abortStepError } = await supabase
                .from('routine_step_instance')
                .update({
                    status: 'ABORTED',
                    ended_at: endedAtIso,
                    updated_at: endedAtIso
                })
                .eq('step_instance_id', stepInstanceId);
            if (abortStepError) throw abortStepError;
        }

        const { error: abortRoutineError } = await supabase
            .from('routine_instance')
            .update({
                status: 'ABORTED',
                ended_at: endedAtIso,
                updated_at: endedAtIso
            })
            .eq('routine_instance_id', routineInstanceId)
            .neq('status', 'DONE');
        if (abortRoutineError) throw abortRoutineError;
        return;
    }

    if (status !== 'DONE') return;

    if (context.workoutSet?.status === 'RUNNING') {
        const actualValue = toNullableNonNegativeInt(resultFields?.total_result_value);
        const durationSec = toNullableNonNegativeInt(resultFields?.duration_sec) ||
            computeDurationSecFromRange(context.workoutSet?.started_at || session.started_at, endedAtIso);
        const targetValue = toNullableNonNegativeInt(context.workoutSet?.target_value);
        const resultBasis = normalizeResultBasis(resultFields?.result_basis) || getResultBasisByTargetType(targetType);
        const resultUnit = normalizeResultUnit(resultFields?.total_result_unit) || getResultUnitByTargetType(targetType);

        let isSuccess = null;
        if (actualValue != null && targetValue != null) {
            isSuccess = actualValue >= targetValue;
        }

        const { error: updateSetError } = await supabase
            .from('workout_set')
            .update({
                actual_value: actualValue,
                value_unit: resultUnit,
                result_basis: resultBasis,
                score: normalizedFinalScore,
                is_success: isSuccess,
                duration_sec: durationSec,
                status: 'DONE',
                ended_at: endedAtIso,
                updated_at: endedAtIso
            })
            .eq('set_id', session.set_id)
            .eq('status', 'RUNNING');
        if (updateSetError) throw updateSetError;
    }

    if (stepInstanceId) {
        const { data: stepSets, error: stepSetsError } = await supabase
            .from('workout_set')
            .select('status, set_no')
            .eq('step_instance_id', stepInstanceId);
        if (stepSetsError) throw stepSetsError;

        const plannedSets = Math.max(1, toNullableNonNegativeInt(context.stepInstance?.planned_sets) || 1);
        const doneSetCount = (stepSets || []).filter((row) => row.status === 'DONE').length;
        const existingCompletedSets = Math.max(0, toNullableNonNegativeInt(context.stepInstance?.completed_sets) || 0);
        const eventCompletedSets = Math.max(0, toNullableNonNegativeInt(completedSets) || 0);
        const resolvedCompletedSets = Math.min(
            plannedSets,
            Math.max(doneSetCount, existingCompletedSets, eventCompletedSets)
        );
        const isStepDone = resolvedCompletedSets >= plannedSets;

        const { error: updateStepError } = await supabase
            .from('routine_step_instance')
            .update({
                completed_sets: resolvedCompletedSets,
                status: isStepDone ? 'DONE' : 'ABORTED',
                ended_at: endedAtIso,
                updated_at: endedAtIso
            })
            .eq('step_instance_id', stepInstanceId);
        if (updateStepError) throw updateStepError;
    }

    const { data: stepInstances, error: stepInstancesError } = await supabase
        .from('routine_step_instance')
        .select('planned_sets, completed_sets, status')
        .eq('routine_instance_id', routineInstanceId);
    if (stepInstancesError) throw stepInstancesError;

    const isRoutineDone = Array.isArray(stepInstances) &&
        stepInstances.length > 0 &&
        stepInstances.every((row) => {
            const planned = Math.max(1, toNullableNonNegativeInt(row?.planned_sets) || 1);
            const completed = Math.max(0, toNullableNonNegativeInt(row?.completed_sets) || 0);
            return row?.status === 'DONE' && completed >= planned;
        });

    const routineUpdate = {
        status: isRoutineDone ? 'DONE' : 'ABORTED',
        ended_at: endedAtIso,
        updated_at: endedAtIso
    };

    if (normalizedFinalScore != null && isRoutineDone) {
        routineUpdate.total_score = normalizedFinalScore;
    }

    const { error: updateRoutineError } = await supabase
        .from('routine_instance')
        .update(routineUpdate)
        .eq('routine_instance_id', routineInstanceId);
    if (updateRoutineError) throw updateRoutineError;
};

const cleanupStaleOpenSessions = async (userId) => {
    const thresholdIso = new Date(Date.now() - SESSION_STALE_HOURS * 60 * 60 * 1000).toISOString();

    const { data: staleSessions, error } = await supabase
        .from('workout_session')
        .select('session_id, set_id, mode, started_at')
        .eq('user_id', userId)
        .eq('status', 'RUNNING')
        .is('ended_at', null)
        .lt('started_at', thresholdIso);

    if (error) {
        throw createApiError(500, '기존 실행 중 세션 정리 중 오류가 발생했습니다.');
    }

    const staleIds = (staleSessions || []).map((row) => row.session_id);
    if (staleIds.length === 0) return;

    const endedAtIso = new Date().toISOString();

    const { error: updateError } = await supabase
        .from('workout_session')
        .update({
            status: 'ABORTED',
            ended_at: endedAtIso,
            updated_at: endedAtIso
        })
        .in('session_id', staleIds)
        .eq('status', 'RUNNING');

    if (updateError) {
        throw createApiError(500, '기존 실행 중 세션을 중단 처리하지 못했습니다.');
    }

    const staleEventRows = staleIds.map((sessionId) => ({
        session_id: sessionId,
        type: 'SESSION_ABORT_STALE',
        event_time: endedAtIso
    }));

    await supabase.from('session_event').insert(staleEventRows);

    for (const staleSession of staleSessions || []) {
        if (staleSession?.mode !== 'ROUTINE' || !staleSession?.set_id) continue;
        try {
            await syncRoutineExecutionFromSession({
                session: staleSession,
                userId,
                status: 'ABORTED',
                endedAtIso
            });
        } catch (routineSyncError) {
            console.error('Routine execution stale abort sync failed:', routineSyncError);
        }
    }
};

const normalizeEvents = (events, sessionId, startedAtIso) => {
    if (!Array.isArray(events) || events.length === 0) return [];

    const sessionStartMs = new Date(startedAtIso).getTime();
    const nowIso = new Date().toISOString();

    return events
        .map((event) => {
            const type = typeof event?.type === 'string' ? event.type.trim() : '';
            if (!type) return null;

            const timestampMs = Number(event?.timestamp ?? event?.timestamp_ms);
            const hasRelativeTimestamp = Number.isFinite(timestampMs) && timestampMs >= 0;
            const eventTime = hasRelativeTimestamp
                ? new Date(sessionStartMs + Math.round(timestampMs)).toISOString()
                : nowIso;

            return {
                session_id: sessionId,
                type: type.slice(0, 50),
                event_time: eventTime
            };
        })
        .filter(Boolean);
};

const normalizeSnapshotBreakdownMetrics = (breakdown) => {
    if (!Array.isArray(breakdown)) return [];

    return breakdown
        .map((item, index) => {
            const metricKey = toSafeText(item?.metric_key || item?.key || item?.metric_id || `metric_${index + 1}`, 100);
            if (!metricKey) return null;

            const metricName =
                toSafeText(item?.metric_name || item?.title || metricKey, 100) ||
                metricKey;

            const avgScore = item?.avg_score != null
                ? Number(item.avg_score)
                : (item?.score != null ? Number(item.score) : null);

            const rawValue = item?.avg_raw_value != null
                ? Number(item.avg_raw_value)
                : (item?.rawValue != null
                    ? Number(item.rawValue)
                    : (item?.raw != null
                        ? Number(item.raw)
                        : (item?.actualValue != null ? Number(item.actualValue) : null)));

            const minRaw = item?.min_raw_value != null
                ? Number(item.min_raw_value)
                : (Number.isFinite(rawValue) ? rawValue : null);

            const maxRaw = item?.max_raw_value != null
                ? Number(item.max_raw_value)
                : (Number.isFinite(rawValue) ? rawValue : null);

            const sampleCount = item?.sample_count != null
                ? Math.max(0, Math.round(Number(item.sample_count)))
                : (Number.isFinite(avgScore) || Number.isFinite(rawValue) ? 1 : 0);

            return {
                metric_key: metricKey,
                metric_name: metricName,
                avg_score: Number.isFinite(avgScore) ? Math.max(0, Math.min(100, avgScore)) : null,
                avg_raw_value: Number.isFinite(rawValue) ? rawValue : null,
                min_raw_value: Number.isFinite(minRaw) ? minRaw : null,
                max_raw_value: Number.isFinite(maxRaw) ? maxRaw : null,
                sample_count: sampleCount
            };
        })
        .filter(Boolean);
};

const normalizeFinalMetricResults = (metricResults) => {
    if (!Array.isArray(metricResults) || metricResults.length === 0) return [];
    return normalizeSnapshotBreakdownMetrics(metricResults);
};

const normalizeInterimSnapshots = (payload, startedAtIso) => {
    const explicitSnapshots = Array.isArray(payload?.interim_snapshots)
        ? payload.interim_snapshots
        : [];

    if (explicitSnapshots.length === 0) return [];

    const startedMs = new Date(startedAtIso).getTime();

    return explicitSnapshots
        .map((snapshot, index) => {
            const timestampMs = Number(snapshot?.timestamp_ms ?? snapshot?.timestamp);
            const hasRelativeTimestamp = Number.isFinite(timestampMs) && timestampMs >= 0;
            const recordedAt = hasRelativeTimestamp
                ? new Date(startedMs + Math.round(timestampMs)).toISOString()
                : new Date().toISOString();

            const score = snapshot?.score == null ? null : Number(snapshot.score);
            const breakdownMetrics = normalizeSnapshotBreakdownMetrics(snapshot?.breakdown || []);

            return {
                snapshot_no: index + 1,
                snapshot_type: 'INTERIM',
                recorded_at: recordedAt,
                score: Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : null,
                result_value: toNullableNonNegativeInt(snapshot?.result_value),
                result_unit: normalizeResultUnit(snapshot?.result_unit),
                summary_feedback: toSafeText(snapshot?.summary_feedback, 500),
                metrics: breakdownMetrics
            };
        })
        .filter(Boolean);
};

const inferResultFields = (payload, session, endedAtIso) => {
    let resultBasis = normalizeResultBasis(payload?.result_basis);
    let totalResultValue = toNullableNonNegativeInt(payload?.total_result_value);
    let totalResultUnit = normalizeResultUnit(payload?.total_result_unit);

    const legacyTotalReps = toNullableNonNegativeInt(payload?.total_reps);
    const legacyDurationSec = toNullableNonNegativeInt(payload?.duration_sec);
    const computedDurationSec = computeDurationSecFromRange(session.started_at, endedAtIso);

    if (!resultBasis) {
        resultBasis = legacyTotalReps != null ? 'REPS' : 'DURATION';
    }

    if (resultBasis === 'REPS') {
        if (!totalResultUnit) totalResultUnit = 'COUNT';
        if (totalResultValue == null) {
            totalResultValue = legacyTotalReps != null ? legacyTotalReps : 0;
        }
    } else {
        if (!totalResultUnit) totalResultUnit = 'SEC';
        if (totalResultValue == null) {
            totalResultValue = legacyDurationSec != null ? legacyDurationSec : computedDurationSec;
        }
    }

    return {
        result_basis: resultBasis,
        total_result_value: totalResultValue,
        total_result_unit: totalResultUnit,
        duration_sec: legacyDurationSec != null ? legacyDurationSec : computedDurationSec,
        total_reps: legacyTotalReps != null ? legacyTotalReps : (resultBasis === 'REPS' ? totalResultValue : 0)
    };
};

const getOwnedSession = async (sessionId, userId) => {
    const { data: session, error } = await supabase
        .from('workout_session')
        .select(`
            session_id,
            user_id,
            exercise_id,
            set_id,
            mode,
            status,
            selected_view,
            result_basis,
            total_result_value,
            total_result_unit,
            final_score,
            summary_feedback,
            started_at,
            ended_at,
            exercise:exercise_id (
                exercise_id,
                code,
                name
            )
        `)
        .eq('session_id', sessionId)
        .eq('user_id', userId)
        .single();

    if (error || !session) {
        throw createApiError(404, '세션을 찾을 수 없습니다.');
    }

    return session;
};

const assertSessionWritable = async (sessionId, userId) => {
    const session = await getOwnedSession(sessionId, userId);
    if (session.ended_at || session.status !== 'RUNNING') {
        throw createApiError(409, '이미 종료된 세션입니다.');
    }
    return session;
};

const getFreeWorkoutPage = async (req, res, next) => {
    try {
        await syncExerciseCatalog();

        const { data: exercises, error } = await supabase
            .from('exercise')
            .select('exercise_id, code, name, description, default_target_type')
            .eq('is_active', true)
            .order('name');

        if (error) throw error;

        const exerciseRows = exercises || [];
        const viewMap = await getAllowedViewMapByExerciseIds(exerciseRows.map((item) => item.exercise_id));
        const enriched = exerciseRows.map((exercise) =>
            attachAllowedViewInfo(exercise, viewMap.get(exercise.exercise_id) || [])
        );

        res.render('workout/free', {
            title: '자유 운동',
            activeTab: 'workout',
            exercises: enriched
        });
    } catch (error) {
        next(error);
    }
};

const getFreeWorkoutSession = async (req, res, next) => {
    try {
        await syncExerciseCatalog();

        const { exerciseCode } = req.params;
        const exercise = await getExerciseByCodeWithViews(exerciseCode);

        if (!exercise) {
            return res.redirect('/workout/free?error=운동을 찾을 수 없습니다');
        }

        res.render('workout/session', {
            title: `${exercise.name} - 자유 운동`,
            activeTab: 'workout',
            mode: 'FREE',
            exercise,
            scoringProfile: getRuntimeScoringProfile(exercise.code),
            routine: null,
            routineInstance: null,
            exerciseModuleScript: getExerciseModuleScriptName(exercise.code),
            exerciseModuleScripts: null,
            layout: 'layouts/workout'
        });
    } catch (error) {
        next(error);
    }
};

const getRoutineWorkoutSession = async (req, res, next) => {
    try {
        const { routineId } = req.params;
        const userId = req.user.user_id;
        const routine = await getRoutineWithSteps(routineId, userId);

        const firstStep = routine.routine_setup[0];
        if (!firstStep?.exercise) {
            return res.redirect('/routine?error=루틴 시작에 필요한 운동 정보가 없습니다');
        }

        const moduleScriptSet = new Set();
        routine.routine_setup.forEach((step) => {
            const code = step?.exercise?.code || '';
            if (code) moduleScriptSet.add(getExerciseModuleScriptName(code));
        });

        res.render('workout/session', {
            title: `${routine.name} - 루틴 운동`,
            activeTab: 'workout',
            mode: 'ROUTINE',
            exercise: firstStep.exercise,
            scoringProfile: firstStep.scoring_profile || getRuntimeScoringProfile(firstStep.exercise.code),
            routine,
            routineInstance: null,
            exerciseModuleScript: null,
            exerciseModuleScripts: Array.from(moduleScriptSet),
            layout: 'layouts/workout'
        });
    } catch (error) {
        next(error);
    }
};

const startWorkoutSession = async (req, res) => {
    let routineContext = null;
    let sessionCreated = false;

    try {
        const userId = req.user.user_id;
        const mode = normalizeMode(req.body?.mode);
        const requestedExerciseId = Number(req.body?.exercise_id);
        const routineId = toNullableNonNegativeInt(req.body?.routine_id);
        let setId = toNullableNonNegativeInt(req.body?.set_id);
        let exercise = null;

        await cleanupStaleOpenSessions(userId);

        if (mode === 'ROUTINE') {
            if (!Number.isFinite(routineId)) {
                throw createApiError(400, 'ROUTINE 모드에는 routine_id가 필요합니다.');
            }

            const routine = await getRoutineWithSteps(routineId, userId);
            routineContext = await createRoutineStartContext(routine, userId);
            setId = routineContext.set_id;
            exercise = routineContext.exercise;

            if (
                Number.isFinite(requestedExerciseId) &&
                requestedExerciseId !== Number(routineContext.exercise?.exercise_id)
            ) {
                console.warn('[Workout] ROUTINE start exercise mismatch', {
                    requestedExerciseId,
                    resolvedExerciseId: routineContext.exercise?.exercise_id,
                    routineId
                });
            }
        } else {
            if (!Number.isFinite(requestedExerciseId)) {
                throw createApiError(400, 'exercise_id는 필수입니다.');
            }

            exercise = await getExerciseByIdWithViews(requestedExerciseId);
            if (!exercise) {
                throw createApiError(400, '유효하지 않은 운동입니다.');
            }
        }

        const requestedView = normalizeSelectedView(req.body?.selected_view);
        const allowedViews = Array.isArray(exercise.allowed_views) ? exercise.allowed_views : ['FRONT'];
        const defaultView = exercise.default_view || allowedViews[0] || 'FRONT';

        if (requestedView && !allowedViews.includes(requestedView)) {
            throw createApiError(400, '선택한 자세는 이 운동에서 사용할 수 없습니다.');
        }

        const selectedView = requestedView || defaultView;

        const insertPayload = {
            user_id: userId,
            exercise_id: exercise.exercise_id,
            set_id: mode === 'ROUTINE' ? setId : null,
            mode,
            status: 'RUNNING',
            selected_view: selectedView
        };

        const { data: session, error: sessionError } = await supabase
            .from('workout_session')
            .insert(insertPayload)
            .select(`
                session_id,
                user_id,
                exercise_id,
                set_id,
                mode,
                status,
                selected_view,
                started_at,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name
                )
            `)
            .single();

        if (sessionError || !session) {
            throw createApiError(500, '운동 세션 생성에 실패했습니다.');
        }
        sessionCreated = true;

        return res.json({
            success: true,
            session,
            routineInstance: routineContext?.routine_instance || null,
            stepInstance: routineContext?.step_instance || null,
            workoutSet: routineContext?.workout_set || null
        });
    } catch (error) {
        if (!sessionCreated && routineContext?.routine_instance?.routine_instance_id) {
            try {
                await supabase
                    .from('routine_instance')
                    .delete()
                    .eq('routine_instance_id', routineContext.routine_instance.routine_instance_id);
            } catch (rollbackError) {
                console.error('Routine start rollback failed:', rollbackError);
            }
        }

        return sendApiError(res, error, '운동 시작에 실패했습니다.');
    }
};
const endWorkoutSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        const session = await getOwnedSession(sessionId, userId);

        if (session.ended_at || session.status === 'DONE') {
            return res.json({
                success: true,
                alreadyEnded: true,
                session
            });
        }

        const endedAtIso = new Date().toISOString();
        const finalScore = toBoundedScore(req.body?.final_score, 0);
        const summaryFeedback = toSafeText(req.body?.summary_feedback, 2000);

        const selectedView = normalizeSelectedView(req.body?.selected_view) || session.selected_view;
        const resultFields = inferResultFields(req.body || {}, session, endedAtIso);

        const normalizedInterimSnapshots = normalizeInterimSnapshots(req.body || {}, session.started_at);
        const normalizedFinalMetrics = normalizeFinalMetricResults(req.body?.metric_results || []);
        const normalizedEvents = normalizeEvents(req.body?.events || [], sessionId, session.started_at);

        const { error: deleteSnapshotError } = await supabase
            .from('session_snapshot')
            .delete()
            .eq('session_id', sessionId);
        if (deleteSnapshotError) {
            throw createApiError(500, '기존 스냅샷 정리에 실패했습니다.');
        }

        const { error: deleteEventError } = await supabase
            .from('session_event')
            .delete()
            .eq('session_id', sessionId);
        if (deleteEventError) {
            throw createApiError(500, '기존 이벤트 정리에 실패했습니다.');
        }

        if (normalizedEvents.length > 0) {
            const { error: insertEventError } = await supabase
                .from('session_event')
                .insert(normalizedEvents);
            if (insertEventError) {
                throw createApiError(500, '세션 이벤트 저장에 실패했습니다.');
            }
        }

        const finalSnapshotNo = normalizedInterimSnapshots.length + 1;
        const snapshotHeaders = [
            ...normalizedInterimSnapshots.map((snapshot) => ({
                session_id: sessionId,
                snapshot_no: snapshot.snapshot_no,
                snapshot_type: 'INTERIM',
                recorded_at: snapshot.recorded_at
            })),
            {
                session_id: sessionId,
                snapshot_no: finalSnapshotNo,
                snapshot_type: 'FINAL',
                recorded_at: endedAtIso
            }
        ];

        const { data: insertedSnapshots, error: insertSnapshotError } = await supabase
            .from('session_snapshot')
            .insert(snapshotHeaders)
            .select('session_snapshot_id, snapshot_no, snapshot_type');

        if (insertSnapshotError || !insertedSnapshots?.length) {
            throw createApiError(500, '스냅샷 헤더 저장에 실패했습니다.');
        }

        const snapshotIdByNo = new Map(
            insertedSnapshots.map((snapshot) => [snapshot.snapshot_no, snapshot.session_snapshot_id])
        );

        const snapshotScoreRows = [];
        const snapshotMetricRows = [];

        for (const interim of normalizedInterimSnapshots) {
            const interimSnapshotId = snapshotIdByNo.get(interim.snapshot_no);
            if (!interimSnapshotId) continue;

            snapshotScoreRows.push({
                session_snapshot_id: interimSnapshotId,
                score: interim.score,
                result_basis: resultFields.result_basis,
                result_value: interim.result_value,
                result_unit: interim.result_unit || resultFields.total_result_unit,
                summary_feedback: interim.summary_feedback
            });

            for (const metric of interim.metrics) {
                snapshotMetricRows.push({
                    session_snapshot_id: interimSnapshotId,
                    metric_key: metric.metric_key,
                    metric_name: metric.metric_name,
                    avg_score: metric.avg_score,
                    avg_raw_value: metric.avg_raw_value,
                    min_raw_value: metric.min_raw_value,
                    max_raw_value: metric.max_raw_value,
                    sample_count: metric.sample_count
                });
            }
        }

        const finalSnapshotId = snapshotIdByNo.get(finalSnapshotNo);
        if (!finalSnapshotId) {
            throw createApiError(500, '최종 스냅샷 생성에 실패했습니다.');
        }

        snapshotScoreRows.push({
            session_snapshot_id: finalSnapshotId,
            score: finalScore,
            result_basis: resultFields.result_basis,
            result_value: resultFields.total_result_value,
            result_unit: resultFields.total_result_unit,
            summary_feedback: summaryFeedback
        });

        for (const metric of normalizedFinalMetrics) {
            snapshotMetricRows.push({
                session_snapshot_id: finalSnapshotId,
                metric_key: metric.metric_key,
                metric_name: metric.metric_name,
                avg_score: metric.avg_score,
                avg_raw_value: metric.avg_raw_value,
                min_raw_value: metric.min_raw_value,
                max_raw_value: metric.max_raw_value,
                sample_count: metric.sample_count
            });
        }

        if (snapshotScoreRows.length > 0) {
            const { error: insertScoreError } = await supabase
                .from('session_snapshot_score')
                .insert(snapshotScoreRows);
            if (insertScoreError) {
                throw createApiError(500, '스냅샷 점수 저장에 실패했습니다.');
            }
        }

        if (snapshotMetricRows.length > 0) {
            const { error: insertMetricError } = await supabase
                .from('session_snapshot_metric')
                .insert(snapshotMetricRows);
            if (insertMetricError) {
                throw createApiError(500, '스냅샷 메트릭 저장에 실패했습니다.');
            }
        }

        const { data: updatedSession, error: updateSessionError } = await supabase
            .from('workout_session')
            .update({
                status: 'DONE',
                ended_at: endedAtIso,
                selected_view: selectedView,
                result_basis: resultFields.result_basis,
                total_result_value: resultFields.total_result_value,
                total_result_unit: resultFields.total_result_unit,
                final_score: finalScore,
                summary_feedback: summaryFeedback,
                updated_at: endedAtIso
            })
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .select(`
                session_id,
                mode,
                status,
                selected_view,
                result_basis,
                total_result_value,
                total_result_unit,
                final_score,
                summary_feedback,
                started_at,
                ended_at,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name
                )
            `)
            .single();

        if (updateSessionError || !updatedSession) {
            throw createApiError(500, '세션 종료 저장에 실패했습니다.');
        }

        const setRecordCount = normalizedEvents
            .filter((event) => event.type === 'SET_RECORD')
            .length;

        try {
            await syncRoutineExecutionFromSession({
                session,
                userId,
                status: 'DONE',
                endedAtIso,
                finalScore,
                resultFields,
                completedSets: setRecordCount > 0 ? setRecordCount : null
            });
        } catch (routineSyncError) {
            console.error('Routine execution sync failed:', routineSyncError);
        }

        try {
            await updateQuestProgress(userId, {
                exercise_code: updatedSession.exercise?.code || session.exercise?.code,
                duration_sec: resultFields.duration_sec,
                total_reps: resultFields.total_reps,
                final_score: finalScore,
                sets: setRecordCount > 0 ? setRecordCount : 1
            });
        } catch (questError) {
            console.error('Quest progress update failed:', questError);
        }

        return res.json({
            success: true,
            session: updatedSession
        });
    } catch (error) {
        return sendApiError(res, error, '운동 종료 저장에 실패했습니다.');
    }
};

const abortWorkoutSession = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        const session = await getOwnedSession(sessionId, userId);

        if (session.ended_at || session.status !== 'RUNNING') {
            return res.json({
                success: true,
                alreadyEnded: true
            });
        }

        const endedAtIso = new Date().toISOString();
        const selectedView = normalizeSelectedView(req.body?.selected_view) || session.selected_view;
        const resultFields = inferResultFields(req.body || {}, session, endedAtIso);

        const { error: updateSessionError } = await supabase
            .from('workout_session')
            .update({
                status: 'ABORTED',
                ended_at: endedAtIso,
                selected_view: selectedView,
                result_basis: resultFields.result_basis,
                total_result_value: resultFields.total_result_value,
                total_result_unit: resultFields.total_result_unit,
                updated_at: endedAtIso
            })
            .eq('session_id', sessionId)
            .eq('user_id', userId);

        if (updateSessionError) {
            throw createApiError(500, '세션 중단 처리에 실패했습니다.');
        }

        try {
            await syncRoutineExecutionFromSession({
                session,
                userId,
                status: 'ABORTED',
                endedAtIso,
                resultFields
            });
        } catch (routineSyncError) {
            console.error('Routine execution abort sync failed:', routineSyncError);
        }

        await supabase.from('session_event').insert({
            session_id: sessionId,
            type: 'SESSION_ABORT',
            event_time: endedAtIso
        });

        return res.json({
            success: true,
            aborted: true
        });
    } catch (error) {
        return sendApiError(res, error, '세션 중단에 실패했습니다.');
    }
};

const getRoutineStepRestSec = async (stepId) => {
    if (!Number.isFinite(Number(stepId))) return 0;

    const { data: stepSetup, error } = await supabase
        .from('routine_setup')
        .select('rest_sec')
        .eq('step_id', stepId)
        .maybeSingle();
    if (error) throw error;

    return Math.max(0, toNullableNonNegativeInt(stepSetup?.rest_sec) || 0);
};

const recordWorkoutSet = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        const session = await assertSessionWritable(sessionId, userId);

        const timestampMs = Number(req.body?.timestamp);
        const hasRelativeTimestamp = Number.isFinite(timestampMs) && timestampMs >= 0;
        const eventTime = hasRelativeTimestamp
            ? new Date(new Date(session.started_at).getTime() + Math.round(timestampMs)).toISOString()
            : new Date().toISOString();

        const { data: event, error } = await supabase
            .from('session_event')
            .insert({
                session_id: sessionId,
                type: 'SET_RECORD',
                event_time: eventTime
            })
            .select()
            .single();

        if (error || !event) {
            throw createApiError(500, '세트 기록 저장에 실패했습니다.');
        }

        if (session.mode !== 'ROUTINE' || !session.set_id) {
            return res.json({ success: true, event, routine: null });
        }

        const context = await loadRoutineExecutionBySetId(session.set_id);
        if (!context?.workoutSet || !context?.stepInstance || !context?.routineInstance) {
            return res.json({
                success: true,
                event,
                routine: {
                    action: 'NO_CONTEXT'
                }
            });
        }

        if (context.routineInstance.user_id !== userId) {
            throw createApiError(403, '루틴 실행 정보에 접근할 수 없습니다.');
        }

        if (context.workoutSet.status !== 'RUNNING') {
            return res.json({
                success: true,
                event,
                routine: {
                    action: 'ALREADY_PROCESSED',
                    set_id: context.workoutSet.set_id,
                    set_no: context.workoutSet.set_no,
                    set_status: context.workoutSet.status
                }
            });
        }

        const targetType = normalizeTargetType(
            context.workoutSet.target_type || context.stepInstance.target_type_snapshot
        );
        const targetValue = Math.max(
            1,
            toNullableNonNegativeInt(context.workoutSet.target_value || context.stepInstance.target_value_snapshot) || 1
        );
        const explicitDurationSec = toNullableNonNegativeInt(req.body?.duration_sec);
        const computedDurationSec = computeDurationSecFromRange(
            context.workoutSet.started_at || session.started_at,
            eventTime
        );

        let actualValue = toNullableNonNegativeInt(req.body?.actual_value);
        if (actualValue == null) {
            actualValue = targetType === 'TIME'
                ? (explicitDurationSec ?? computedDurationSec)
                : toNullableNonNegativeInt(req.body?.actual_reps);
        }
        if (actualValue == null) {
            actualValue = targetType === 'TIME' ? computedDurationSec : 0;
        }

        const durationSec = explicitDurationSec ?? computedDurationSec;
        const score = Number.isFinite(Number(req.body?.score))
            ? toBoundedScore(req.body.score, 0)
            : null;
        const resultBasis = getResultBasisByTargetType(targetType);
        const resultUnit = getResultUnitByTargetType(targetType);
        const isSuccess = actualValue >= targetValue;

        const { data: completedSet, error: updateSetError } = await supabase
            .from('workout_set')
            .update({
                actual_value: actualValue,
                value_unit: resultUnit,
                result_basis: resultBasis,
                score,
                is_success: isSuccess,
                duration_sec: durationSec,
                status: 'DONE',
                ended_at: eventTime,
                updated_at: eventTime
            })
            .eq('set_id', context.workoutSet.set_id)
            .eq('status', 'RUNNING')
            .select('set_id, set_no, step_instance_id, status')
            .maybeSingle();
        if (updateSetError) throw updateSetError;

        if (!completedSet) {
            return res.json({
                success: true,
                event,
                routine: {
                    action: 'ALREADY_PROCESSED',
                    set_id: context.workoutSet.set_id,
                    set_no: context.workoutSet.set_no,
                    set_status: context.workoutSet.status
                }
            });
        }

        const plannedSets = Math.max(1, toNullableNonNegativeInt(context.stepInstance.planned_sets) || 1);
        const currentSetNo = Math.max(1, toNullableNonNegativeInt(completedSet.set_no) || 1);
        const existingCompletedSets = Math.max(0, toNullableNonNegativeInt(context.stepInstance.completed_sets) || 0);
        const resolvedCompletedSets = Math.min(
            plannedSets,
            Math.max(existingCompletedSets, currentSetNo)
        );
        const isCurrentStepDone = resolvedCompletedSets >= plannedSets;

        const stepUpdatePayload = {
            completed_sets: resolvedCompletedSets,
            status: isCurrentStepDone ? 'DONE' : 'RUNNING',
            updated_at: eventTime
        };
        if (!context.stepInstance.started_at) {
            stepUpdatePayload.started_at = eventTime;
        }
        if (isCurrentStepDone) {
            stepUpdatePayload.ended_at = eventTime;
        } else if (context.stepInstance.ended_at) {
            stepUpdatePayload.ended_at = null;
        }

        const { error: updateCurrentStepError } = await supabase
            .from('routine_step_instance')
            .update(stepUpdatePayload)
            .eq('step_instance_id', context.stepInstance.step_instance_id);
        if (updateCurrentStepError) throw updateCurrentStepError;

        if (!isCurrentStepDone) {
            const restSec = await getRoutineStepRestSec(context.stepInstance.step_id);
            const nextSetNo = currentSetNo + 1;

            const { data: nextSet, error: insertNextSetError } = await supabase
                .from('workout_set')
                .insert({
                    step_instance_id: context.stepInstance.step_instance_id,
                    set_no: nextSetNo,
                    target_type: targetType,
                    target_value: targetValue,
                    value_unit: resultUnit,
                    result_basis: resultBasis,
                    rest_sec_after: restSec,
                    status: 'RUNNING',
                    started_at: eventTime,
                    updated_at: eventTime
                })
                .select('set_id, set_no, target_type, target_value, status')
                .single();
            if (insertNextSetError || !nextSet) {
                throw insertNextSetError || new Error('다음 세트 생성에 실패했습니다.');
            }

            const { error: moveSessionSetError } = await supabase
                .from('workout_session')
                .update({
                    set_id: nextSet.set_id,
                    updated_at: eventTime
                })
                .eq('session_id', sessionId)
                .eq('user_id', userId)
                .eq('status', 'RUNNING');
            if (moveSessionSetError) throw moveSessionSetError;

            return res.json({
                success: true,
                event,
                routine: {
                    action: 'NEXT_SET',
                    completed_set_no: currentSetNo,
                    next_set: nextSet,
                    rest_sec: restSec
                }
            });
        }

        const { data: nextStep, error: nextStepError } = await supabase
            .from('routine_step_instance')
            .select(`
                step_instance_id,
                routine_instance_id,
                step_id,
                exercise_id,
                order_no,
                target_type_snapshot,
                target_value_snapshot,
                planned_sets,
                completed_sets,
                status,
                started_at
            `)
            .eq('routine_instance_id', context.stepInstance.routine_instance_id)
            .gt('order_no', context.stepInstance.order_no || 0)
            .order('order_no', { ascending: true })
            .limit(1)
            .maybeSingle();
        if (nextStepError) throw nextStepError;

        if (!nextStep) {
            const { error: completeRoutineError } = await supabase
                .from('routine_instance')
                .update({
                    status: 'DONE',
                    ended_at: eventTime,
                    updated_at: eventTime
                })
                .eq('routine_instance_id', context.routineInstance.routine_instance_id)
                .neq('status', 'ABORTED');
            if (completeRoutineError) throw completeRoutineError;

            return res.json({
                success: true,
                event,
                routine: {
                    action: 'ROUTINE_COMPLETE',
                    completed_set_no: currentSetNo
                }
            });
        }

        const nextTargetType = normalizeTargetType(nextStep.target_type_snapshot);
        const nextTargetValue = Math.max(1, toNullableNonNegativeInt(nextStep.target_value_snapshot) || 1);
        const nextRestSec = await getRoutineStepRestSec(nextStep.step_id);

        const { error: runNextStepError } = await supabase
            .from('routine_step_instance')
            .update({
                status: 'RUNNING',
                started_at: nextStep.started_at || eventTime,
                updated_at: eventTime
            })
            .eq('step_instance_id', nextStep.step_instance_id);
        if (runNextStepError) throw runNextStepError;

        const { data: firstNextStepSet, error: createFirstSetError } = await supabase
            .from('workout_set')
            .insert({
                step_instance_id: nextStep.step_instance_id,
                set_no: 1,
                target_type: nextTargetType,
                target_value: nextTargetValue,
                value_unit: getResultUnitByTargetType(nextTargetType),
                result_basis: getResultBasisByTargetType(nextTargetType),
                rest_sec_after: nextRestSec,
                status: 'RUNNING',
                started_at: eventTime,
                updated_at: eventTime
            })
            .select('set_id, set_no, target_type, target_value, status')
            .single();
        if (createFirstSetError || !firstNextStepSet) {
            throw createFirstSetError || new Error('다음 단계 첫 세트 생성에 실패했습니다.');
        }

        const { error: moveSessionToStepError } = await supabase
            .from('workout_session')
            .update({
                set_id: firstNextStepSet.set_id,
                exercise_id: nextStep.exercise_id,
                updated_at: eventTime
            })
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .eq('status', 'RUNNING');
        if (moveSessionToStepError) throw moveSessionToStepError;

        const nextExercise = await getExerciseByIdWithViews(nextStep.exercise_id);

        return res.json({
            success: true,
            event,
            routine: {
                action: 'NEXT_STEP',
                completed_set_no: currentSetNo,
                next_step: {
                    step_instance_id: nextStep.step_instance_id,
                    order_no: nextStep.order_no,
                    planned_sets: nextStep.planned_sets,
                    completed_sets: nextStep.completed_sets,
                    target_type: nextTargetType,
                    target_value: nextTargetValue
                },
                next_set: firstNextStepSet,
                next_exercise: nextExercise,
                rest_sec: nextRestSec
            }
        });
    } catch (error) {
        return sendApiError(res, error, '세트 기록 저장에 실패했습니다.');
    }
};

const recordSessionEvent = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        const session = await assertSessionWritable(sessionId, userId);

        const type = toSafeText(req.body?.type, 50);
        if (!type) {
            throw createApiError(400, 'type은 필수입니다.');
        }

        const timestampMs = Number(req.body?.timestamp);
        const hasRelativeTimestamp = Number.isFinite(timestampMs) && timestampMs >= 0;
        const eventTime = hasRelativeTimestamp
            ? new Date(new Date(session.started_at).getTime() + Math.round(timestampMs)).toISOString()
            : new Date().toISOString();

        const { data: event, error } = await supabase
            .from('session_event')
            .insert({
                session_id: sessionId,
                type,
                event_time: eventTime
            })
            .select()
            .single();

        if (error || !event) {
            throw createApiError(500, '이벤트 저장에 실패했습니다.');
        }

        return res.json({ success: true, event });
    } catch (error) {
        return sendApiError(res, error, '이벤트 저장에 실패했습니다.');
    }
};

const getWorkoutResult = async (req, res, next) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;

        const { data: session, error } = await supabase
            .from('workout_session')
            .select(`
                session_id,
                mode,
                status,
                selected_view,
                result_basis,
                total_result_value,
                total_result_unit,
                final_score,
                summary_feedback,
                started_at,
                ended_at,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name
                )
            `)
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .single();

        if (error || !session) {
            return res.redirect('/?error=세션을 찾을 수 없습니다');
        }

        const { data: finalSnapshot } = await supabase
            .from('session_snapshot')
            .select('session_snapshot_id, snapshot_no, snapshot_type, recorded_at')
            .eq('session_id', sessionId)
            .eq('snapshot_type', 'FINAL')
            .order('snapshot_no', { ascending: false })
            .limit(1)
            .maybeSingle();

        const snapshotId = finalSnapshot?.session_snapshot_id || null;

        let snapshotScore = null;
        let snapshotMetrics = [];

        if (snapshotId) {
            const [{ data: scoreRow }, { data: metricRows }] = await Promise.all([
                supabase
                    .from('session_snapshot_score')
                    .select('score, result_basis, result_value, result_unit, summary_feedback')
                    .eq('session_snapshot_id', snapshotId)
                    .maybeSingle(),
                supabase
                    .from('session_snapshot_metric')
                    .select('metric_key, metric_name, avg_score, avg_raw_value, min_raw_value, max_raw_value, sample_count')
                    .eq('session_snapshot_id', snapshotId)
                    .order('avg_score', { ascending: false })
            ]);

            snapshotScore = scoreRow || null;
            snapshotMetrics = metricRows || [];
        }

        const mergedResultBasis = session.result_basis || snapshotScore?.result_basis || 'REPS';
        const mergedResultValue = session.total_result_value ?? snapshotScore?.result_value ?? 0;
        const mergedResultUnit = session.total_result_unit || snapshotScore?.result_unit || (mergedResultBasis === 'REPS' ? 'COUNT' : 'SEC');

        const durationSec = computeDurationSecFromRange(
            session.started_at,
            session.ended_at || new Date().toISOString()
        );

        const totalReps = mergedResultBasis === 'REPS' || mergedResultUnit === 'COUNT'
            ? mergedResultValue
            : 0;

        const resultSession = {
            ...session,
            result_basis: mergedResultBasis,
            total_result_value: mergedResultValue,
            total_result_unit: mergedResultUnit,
            final_score: session.final_score ?? snapshotScore?.score ?? 0,
            summary_feedback: session.summary_feedback || snapshotScore?.summary_feedback,
            duration_sec: durationSec,
            total_reps: totalReps,
            session_snapshot_metric: snapshotMetrics
        };

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const { data: todaySessions } = await supabase
            .from('workout_session')
            .select('started_at, ended_at')
            .eq('user_id', userId)
            .eq('status', 'DONE')
            .gte('started_at', today.toISOString());

        const totalTodayMinutes = (todaySessions || []).reduce((sum, row) => {
            return sum + Math.round(computeDurationSecFromRange(row.started_at, row.ended_at) / 60);
        }, 0);

        res.render('workout/result', {
            title: '운동 결과',
            activeTab: 'workout',
            session: resultSession,
            totalTodayMinutes
        });
    } catch (error) {
        next(error);
    }
};

const getExercises = async (req, res, next) => {
    try {
        await syncExerciseCatalog();

        const { data: exercises, error } = await supabase
            .from('exercise')
            .select('exercise_id, code, name, description, default_target_type')
            .eq('is_active', true)
            .order('name');

        if (error) throw error;

        const exerciseRows = exercises || [];
        const viewMap = await getAllowedViewMapByExerciseIds(exerciseRows.map((item) => item.exercise_id));

        const enriched = exerciseRows.map((exercise) => {
            const withViews = attachAllowedViewInfo(exercise, viewMap.get(exercise.exercise_id) || []);
            return {
                ...withViews,
                runtime_scoring_profile: getRuntimeScoringProfile(exercise.code)
            };
        });

        res.json(enriched);
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getFreeWorkoutPage,
    getFreeWorkoutSession,
    getRoutineWorkoutSession,
    startWorkoutSession,
    endWorkoutSession,
    abortWorkoutSession,
    recordWorkoutSet,
    recordSessionEvent,
    getWorkoutResult,
    getExercises
};
