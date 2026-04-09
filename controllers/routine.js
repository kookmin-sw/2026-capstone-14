const { supabase } = require('../config/db');

const ROUTINE_INSTANCE_STATUSES = ['RUNNING', 'DONE', 'ABORTED'];
const TARGET_TYPES = ['REPS', 'TIME'];

const createHttpError = (statusCode, message) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const toSafeInt = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.round(parsed);
};

const normalizeTargetType = (value) => {
    const normalized = String(value || '').trim().toUpperCase();
    if (normalized === 'DURATION') return 'TIME';
    return TARGET_TYPES.includes(normalized) ? normalized : 'REPS';
};

const normalizeRoutineName = (value) => String(value || '').trim();

const normalizeRoutineSteps = (steps = []) => {
    if (!Array.isArray(steps)) return [];

    return steps
        .map((step, index) => ({
            order_no: index + 1,
            exercise_id: toSafeInt(step?.exercise_id, 0),
            target_type: normalizeTargetType(step?.target_type),
            target_value: Math.max(1, toSafeInt(step?.target_value, 10)),
            rest_sec: Math.max(0, toSafeInt(step?.rest_sec, 30)),
            sets: Math.max(1, toSafeInt(step?.sets, 3))
        }))
        .filter((step) => Number.isFinite(step.exercise_id) && step.exercise_id > 0);
};

const ensureValidRoutinePayload = (name, steps) => {
    if (!name) {
        throw createHttpError(400, '루틴 이름을 입력해주세요.');
    }

    if (name.length > 100) {
        throw createHttpError(400, '루틴 이름은 100자 이하여야 합니다.');
    }

    if (!Array.isArray(steps) || steps.length === 0) {
        throw createHttpError(400, '최소 1개의 운동 단계를 추가해주세요.');
    }

    if (steps.length > 30) {
        throw createHttpError(400, '루틴 단계는 최대 30개까지 등록할 수 있습니다.');
    }
};

const verifyExercisesAreActive = async (exerciseIds = []) => {
    if (!exerciseIds.length) {
        throw createHttpError(400, '운동 단계가 비어 있습니다.');
    }

    const uniqueIds = [...new Set(exerciseIds)];
    const { data: exerciseRows, error } = await supabase
        .from('exercise')
        .select('exercise_id')
        .in('exercise_id', uniqueIds)
        .eq('is_active', true);

    if (error) throw error;

    const existingSet = new Set((exerciseRows || []).map((row) => row.exercise_id));
    const missingIds = uniqueIds.filter((id) => !existingSet.has(id));

    if (missingIds.length > 0) {
        throw createHttpError(400, '유효하지 않거나 비활성화된 운동이 포함되어 있습니다.');
    }
};

const sortRoutineSteps = (routineSetup = []) =>
    [...routineSetup].sort((a, b) => (a.order_no || 0) - (b.order_no || 0));

const buildRoutineStatsById = (instances = [], routineIds = []) => {
    const initialMap = new Map(
        routineIds.map((routineId) => [routineId, {
            total_runs: 0,
            done_runs: 0,
            aborted_runs: 0,
            running_runs: 0,
            avg_score: null,
            best_score: null,
            last_run_at: null,
            last_status: null
        }])
    );

    for (const instance of instances || []) {
        const routineId = instance.routine_id;
        if (!initialMap.has(routineId)) {
            initialMap.set(routineId, {
                total_runs: 0,
                done_runs: 0,
                aborted_runs: 0,
                running_runs: 0,
                avg_score: null,
                best_score: null,
                last_run_at: null,
                last_status: null
            });
        }

        const stats = initialMap.get(routineId);
        const status = String(instance.status || '').toUpperCase();
        const score = Number(instance.total_score);
        const runAt = instance.ended_at || instance.started_at || null;

        stats.total_runs += 1;
        if (status === 'DONE') stats.done_runs += 1;
        if (status === 'ABORTED') stats.aborted_runs += 1;
        if (status === 'RUNNING') stats.running_runs += 1;

        if (runAt) {
            const currentLast = stats.last_run_at ? new Date(stats.last_run_at).getTime() : 0;
            const incoming = new Date(runAt).getTime();
            if (!Number.isNaN(incoming) && incoming > currentLast) {
                stats.last_run_at = runAt;
                stats.last_status = status;
            }
        }

        if (status === 'DONE' && Number.isFinite(score)) {
            if (!Array.isArray(stats._scores)) {
                stats._scores = [];
            }
            stats._scores.push(score);
            stats.best_score = stats.best_score == null
                ? score
                : Math.max(stats.best_score, score);
        }
    }

    for (const stats of initialMap.values()) {
        const scores = Array.isArray(stats._scores) ? stats._scores : [];
        stats.avg_score = scores.length > 0
            ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
            : null;
        delete stats._scores;
    }

    return initialMap;
};

const getRoutineInstancesByRoutineIds = async (userId, routineIds = [], limit = null) => {
    if (!routineIds.length) return [];

    let query = supabase
        .from('routine_instance')
        .select('routine_instance_id, routine_id, status, started_at, ended_at, total_score')
        .eq('user_id', userId)
        .in('routine_id', routineIds)
        .in('status', ROUTINE_INSTANCE_STATUSES)
        .order('started_at', { ascending: false });

    if (Number.isFinite(limit) && limit > 0) {
        query = query.limit(limit);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
};

// 루틴 목록 페이지
const getRoutinesPage = async (req, res, next) => {
    try {
        const userId = req.user.user_id;

        const [{ data: routines, error: routineError }, { data: exercises, error: exerciseError }] = await Promise.all([
            supabase
                .from('routine')
                .select(`
                    routine_id,
                    name,
                    is_active,
                    created_at,
                    updated_at,
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
                            default_target_type
                        )
                    )
                `)
                .eq('user_id', userId)
                .eq('is_active', true)
                .order('updated_at', { ascending: false }),
            supabase
                .from('exercise')
                .select('exercise_id, code, name, description, default_target_type')
                .eq('is_active', true)
                .order('name')
        ]);

        if (routineError) throw routineError;
        if (exerciseError) throw exerciseError;

        const routineList = routines || [];
        const routineIds = routineList.map((routine) => routine.routine_id);
        const instances = await getRoutineInstancesByRoutineIds(userId, routineIds);
        const statsByRoutineId = buildRoutineStatsById(instances, routineIds);

        const normalizedRoutines = routineList.map((routine) => {
            const orderedSteps = sortRoutineSteps(routine.routine_setup || []);
            const totalSets = orderedSteps.reduce((sum, step) => sum + Math.max(1, Number(step.sets) || 1), 0);

            return {
                ...routine,
                routine_setup: orderedSteps,
                total_steps: orderedSteps.length,
                total_sets: totalSets,
                runtime_stats: statsByRoutineId.get(routine.routine_id) || {
                    total_runs: 0,
                    done_runs: 0,
                    aborted_runs: 0,
                    running_runs: 0,
                    avg_score: null,
                    best_score: null,
                    last_run_at: null,
                    last_status: null
                }
            };
        });

        res.render('routine/index', {
            title: '나의 루틴',
            activeTab: 'routine',
            routines: normalizedRoutines,
            exercises: exercises || []
        });
    } catch (error) {
        next(error);
    }
};

// 루틴 상세 조회 API
const getRoutineDetail = async (req, res, next) => {
    try {
        const routineId = Number.parseInt(req.params.routineId, 10);
        const userId = req.user.user_id;

        if (!Number.isFinite(routineId)) {
            return res.status(400).json({ error: '유효하지 않은 루틴 ID입니다.' });
        }

        const { data: routine, error } = await supabase
            .from('routine')
            .select(`
                routine_id,
                name,
                is_active,
                created_at,
                updated_at,
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
                        default_target_type
                    )
                )
            `)
            .eq('routine_id', routineId)
            .eq('user_id', userId)
            .maybeSingle();

        if (error) throw error;
        if (!routine) {
            return res.status(404).json({ error: '루틴을 찾을 수 없습니다.' });
        }

        const instances = await getRoutineInstancesByRoutineIds(userId, [routineId], 20);
        const statsByRoutineId = buildRoutineStatsById(instances, [routineId]);
        const orderedSteps = sortRoutineSteps(routine.routine_setup || []);

        const instanceIds = instances.map((instance) => instance.routine_instance_id);
        let stepInstances = [];
        if (instanceIds.length > 0) {
            const { data: stepRows, error: stepError } = await supabase
                .from('routine_step_instance')
                .select(`
                    step_instance_id,
                    routine_instance_id,
                    exercise_id,
                    order_no,
                    planned_sets,
                    completed_sets,
                    status,
                    started_at,
                    ended_at
                `)
                .in('routine_instance_id', instanceIds)
                .order('order_no', { ascending: true });
            if (stepError) throw stepError;
            stepInstances = stepRows || [];
        }

        const stepSummaryByInstanceId = new Map();
        for (const step of stepInstances) {
            const key = step.routine_instance_id;
            if (!stepSummaryByInstanceId.has(key)) {
                stepSummaryByInstanceId.set(key, {
                    step_count: 0,
                    planned_sets: 0,
                    completed_sets: 0
                });
            }

            const target = stepSummaryByInstanceId.get(key);
            target.step_count += 1;
            target.planned_sets += Number(step.planned_sets) || 0;
            target.completed_sets += Number(step.completed_sets) || 0;
        }

        const recent_instances = instances.map((instance) => ({
            ...instance,
            step_summary: stepSummaryByInstanceId.get(instance.routine_instance_id) || {
                step_count: 0,
                planned_sets: 0,
                completed_sets: 0
            }
        }));

        return res.json({
            ...routine,
            routine_setup: orderedSteps,
            runtime_stats: statsByRoutineId.get(routineId),
            recent_instances
        });
    } catch (error) {
        next(error);
    }
};

const getExercisesForRoutineEdit = async () => {
    const { data: exercises, error } = await supabase
        .from('exercise')
        .select('exercise_id, code, name, description, default_target_type')
        .eq('is_active', true)
        .order('name');

    if (error) throw error;
    return exercises || [];
};

// 새 루틴 생성 페이지
const getNewRoutinePage = async (req, res, next) => {
    try {
        const exercises = await getExercisesForRoutineEdit();

        res.render('routine/edit', {
            title: '새 루틴 만들기',
            activeTab: 'routine',
            routine: null,
            exercises,
            isNew: true
        });
    } catch (error) {
        next(error);
    }
};

// 루틴 수정 페이지
const getEditRoutinePage = async (req, res, next) => {
    try {
        const routineId = Number.parseInt(req.params.routineId, 10);
        const userId = req.user.user_id;

        if (!Number.isFinite(routineId)) {
            return res.redirect('/routine?error=유효하지 않은 루틴 ID입니다');
        }

        const { data: routine, error } = await supabase
            .from('routine')
            .select(`
                routine_id,
                name,
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
                        default_target_type
                    )
                )
            `)
            .eq('routine_id', routineId)
            .eq('user_id', userId)
            .eq('is_active', true)
            .maybeSingle();

        if (error) throw error;
        if (!routine) {
            return res.redirect('/routine?error=루틴을 찾을 수 없습니다');
        }

        const exercises = await getExercisesForRoutineEdit();

        res.render('routine/edit', {
            title: '루틴 수정',
            activeTab: 'routine',
            routine: {
                ...routine,
                routine_setup: sortRoutineSteps(routine.routine_setup || [])
            },
            exercises,
            isNew: false
        });
    } catch (error) {
        next(error);
    }
};

const persistRoutineSteps = async (routineId, steps) => {
    if (!steps.length) return;

    const setupRows = steps.map((step, index) => ({
        routine_id: routineId,
        order_no: index + 1,
        exercise_id: step.exercise_id,
        target_type: step.target_type,
        target_value: step.target_value,
        rest_sec: step.rest_sec,
        sets: step.sets
    }));

    const { error } = await supabase
        .from('routine_setup')
        .insert(setupRows);
    if (error) throw error;
};

// 루틴 생성 API
const createRoutine = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const name = normalizeRoutineName(req.body?.name);
        const steps = normalizeRoutineSteps(req.body?.steps);

        ensureValidRoutinePayload(name, steps);
        await verifyExercisesAreActive(steps.map((step) => step.exercise_id));

        const { data: routine, error: routineError } = await supabase
            .from('routine')
            .insert({
                user_id: userId,
                name
            })
            .select('routine_id')
            .single();
        if (routineError || !routine) throw routineError || createHttpError(500, '루틴 생성에 실패했습니다.');

        await persistRoutineSteps(routine.routine_id, steps);

        return res.json({ success: true, routine_id: routine.routine_id });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        next(error);
    }
};

// 루틴 수정 API
const updateRoutine = async (req, res, next) => {
    try {
        const routineId = Number.parseInt(req.params.routineId, 10);
        const userId = req.user.user_id;
        const name = normalizeRoutineName(req.body?.name);
        const steps = normalizeRoutineSteps(req.body?.steps);

        if (!Number.isFinite(routineId)) {
            return res.status(400).json({ error: '유효하지 않은 루틴 ID입니다.' });
        }

        ensureValidRoutinePayload(name, steps);
        await verifyExercisesAreActive(steps.map((step) => step.exercise_id));

        const { data: existing, error: checkError } = await supabase
            .from('routine')
            .select('routine_id')
            .eq('routine_id', routineId)
            .eq('user_id', userId)
            .eq('is_active', true)
            .maybeSingle();

        if (checkError) throw checkError;
        if (!existing) {
            return res.status(404).json({ error: '루틴을 찾을 수 없습니다.' });
        }

        const nowIso = new Date().toISOString();
        const { error: updateError } = await supabase
            .from('routine')
            .update({ name, updated_at: nowIso })
            .eq('routine_id', routineId)
            .eq('user_id', userId);
        if (updateError) throw updateError;

        const { error: deleteError } = await supabase
            .from('routine_setup')
            .delete()
            .eq('routine_id', routineId);
        if (deleteError) throw deleteError;

        await persistRoutineSteps(routineId, steps);

        return res.json({ success: true });
    } catch (error) {
        if (error?.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        next(error);
    }
};

// 루틴 삭제 API (soft delete)
const deleteRoutine = async (req, res, next) => {
    try {
        const routineId = Number.parseInt(req.params.routineId, 10);
        const userId = req.user.user_id;

        if (!Number.isFinite(routineId)) {
            return res.status(400).json({ error: '유효하지 않은 루틴 ID입니다.' });
        }

        const { count: runningCount, error: runningError } = await supabase
            .from('routine_instance')
            .select('routine_instance_id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('routine_id', routineId)
            .eq('status', 'RUNNING');
        if (runningError) throw runningError;

        if ((runningCount || 0) > 0) {
            return res.status(409).json({ error: '진행 중인 루틴 실행이 있어 삭제할 수 없습니다.' });
        }

        const { error } = await supabase
            .from('routine')
            .update({
                is_active: false,
                updated_at: new Date().toISOString()
            })
            .eq('routine_id', routineId)
            .eq('user_id', userId);
        if (error) throw error;

        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getRoutinesPage,
    getRoutineDetail,
    getNewRoutinePage,
    getEditRoutinePage,
    createRoutine,
    updateRoutine,
    deleteRoutine
};

