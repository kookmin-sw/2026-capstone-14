const { supabase } = require('../config/db');
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

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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

const cleanupStaleOpenSessions = async (userId) => {
    const thresholdIso = new Date(Date.now() - SESSION_STALE_HOURS * 60 * 60 * 1000).toISOString();

    const { data: staleSessions, error } = await supabase
        .from('workout_session')
        .select('session_id')
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
        payload: {
            reason: 'STALE_TIMEOUT',
            stale_hours: SESSION_STALE_HOURS
        },
        event_time: endedAtIso
    }));

    await supabase.from('session_event').insert(staleEventRows);
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
                payload: isPlainObject(event?.payload) ? event.payload : (event?.payload ?? {}),
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
                sample_count: sampleCount,
                detail: isPlainObject(item?.detail)
                    ? item.detail
                    : {
                        max_score: Number.isFinite(Number(item?.maxScore)) ? Number(item.maxScore) : null,
                        weight: Number.isFinite(Number(item?.weight)) ? Number(item.weight) : null,
                        feedback: toSafeText(item?.feedback, 500)
                    }
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

    const timelineSnapshots = explicitSnapshots.length === 0 && Array.isArray(payload?.detail?.score_timeline)
        ? payload.detail.score_timeline
        : [];

    const sourceSnapshots = explicitSnapshots.length > 0
        ? explicitSnapshots
        : timelineSnapshots.map((item) => ({
            timestamp_ms: item?.timestamp,
            score: item?.score,
            breakdown: item?.breakdown
        }));

    if (sourceSnapshots.length === 0) return [];

    const startedMs = new Date(startedAtIso).getTime();

    return sourceSnapshots
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
                detail: isPlainObject(snapshot?.detail) ? snapshot.detail : {},
                metrics: breakdownMetrics
            };
        })
        .filter(Boolean);
};

const buildFinalDetail = (payload, normalizedEvents, normalizedInterimSnapshots) => {
    const sourceDetail = isPlainObject(payload?.detail) ? payload.detail : {};
    const setRecords = Array.isArray(payload?.set_records) ? payload.set_records : [];

    return {
        ...sourceDetail,
        selected_view: normalizeSelectedView(payload?.selected_view) || null,
        set_records: setRecords,
        event_count: normalizedEvents.length,
        interim_snapshot_count: normalizedInterimSnapshots.length,
        saved_at: new Date().toISOString(),
        schema_version: 3
    };
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

const getOwnedSessionWithDetail = async (sessionId, userId) => {
    const session = await getOwnedSession(sessionId, userId);

    const { data: finalSnapshot, error: snapshotError } = await supabase
        .from('session_snapshot')
        .select('session_snapshot_id')
        .eq('session_id', sessionId)
        .eq('snapshot_type', 'FINAL')
        .order('snapshot_no', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (snapshotError) {
        throw createApiError(500, '최종 스냅샷 조회에 실패했습니다.');
    }

    if (!finalSnapshot?.session_snapshot_id) {
        return {
            ...session,
            final_snapshot_id: null,
            detail: {}
        };
    }

    const { data: snapshotScore, error: scoreError } = await supabase
        .from('session_snapshot_score')
        .select('detail')
        .eq('session_snapshot_id', finalSnapshot.session_snapshot_id)
        .maybeSingle();

    if (scoreError) {
        throw createApiError(500, '최종 스냅샷 상세 조회에 실패했습니다.');
    }

    return {
        ...session,
        final_snapshot_id: finalSnapshot.session_snapshot_id,
        detail: isPlainObject(snapshotScore?.detail) ? snapshotScore.detail : {}
    };
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
    try {
        const userId = req.user.user_id;
        const mode = normalizeMode(req.body?.mode);
        const exerciseId = Number(req.body?.exercise_id);
        const setId = toNullableNonNegativeInt(req.body?.set_id);

        await cleanupStaleOpenSessions(userId);

        if (!Number.isFinite(exerciseId)) {
            throw createApiError(400, 'exercise_id는 필수입니다.');
        }

        const exercise = await getExerciseByIdWithViews(exerciseId);
        if (!exercise) {
            throw createApiError(400, '유효하지 않은 운동입니다.');
        }

        const requestedView = normalizeSelectedView(req.body?.selected_view);
        const allowedViews = Array.isArray(exercise.allowed_views) ? exercise.allowed_views : ['FRONT'];
        const defaultView = exercise.default_view || allowedViews[0] || 'FRONT';

        if (requestedView && !allowedViews.includes(requestedView)) {
            throw createApiError(400, '선택한 자세가 운동 허용 자세 목록에 없습니다.');
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

        return res.json({
            success: true,
            session
        });
    } catch (error) {
        return sendApiError(res, error, '운동 세션 시작에 실패했습니다.');
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
        const finalDetail = buildFinalDetail(req.body || {}, normalizedEvents, normalizedInterimSnapshots);

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
                summary_feedback: interim.summary_feedback,
                detail: interim.detail || {}
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
                    sample_count: metric.sample_count,
                    detail: metric.detail || {}
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
            summary_feedback: summaryFeedback,
            detail: finalDetail
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
                sample_count: metric.sample_count,
                detail: metric.detail || {}
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

        try {
            await updateQuestProgress(userId, {
                exercise_code: updatedSession.exercise?.code || session.exercise?.code,
                duration_sec: resultFields.duration_sec,
                total_reps: resultFields.total_reps,
                final_score: finalScore,
                sets: Array.isArray(req.body?.set_records) ? req.body.set_records.length : 1
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

        const reason = toSafeText(req.body?.reason || 'USER_ABORT', 120);
        await supabase.from('session_event').insert({
            session_id: sessionId,
            type: 'SESSION_ABORT',
            payload: {
                reason,
                duration_sec: resultFields.duration_sec,
                total_reps: resultFields.total_reps
            },
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

const recordWorkoutSet = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const userId = req.user.user_id;
        const session = await assertSessionWritable(sessionId, userId);

        const payload = {
            set_no: toNullableNonNegativeInt(req.body?.set_no),
            phase: toSafeText(req.body?.phase, 50),
            target_reps: toNullableNonNegativeInt(req.body?.target_reps),
            actual_reps: toNullableNonNegativeInt(req.body?.actual_reps),
            duration_sec: toNullableNonNegativeInt(req.body?.duration_sec)
        };

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
                payload,
                event_time: eventTime
            })
            .select()
            .single();

        if (error || !event) {
            throw createApiError(500, '세트 기록 저장에 실패했습니다.');
        }

        return res.json({ success: true, event });
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

        const payload = isPlainObject(req.body?.payload)
            ? req.body.payload
            : (req.body?.payload ?? {});

        const { data: event, error } = await supabase
            .from('session_event')
            .insert({
                session_id: sessionId,
                type,
                payload,
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
                    .select('score, result_basis, result_value, result_unit, summary_feedback, detail')
                    .eq('session_snapshot_id', snapshotId)
                    .maybeSingle(),
                supabase
                    .from('session_snapshot_metric')
                    .select('metric_key, metric_name, avg_score, avg_raw_value, min_raw_value, max_raw_value, sample_count, detail')
                    .eq('session_snapshot_id', snapshotId)
                    .order('avg_score', { ascending: false })
            ]);

            snapshotScore = scoreRow || null;
            snapshotMetrics = metricRows || [];
        }

        const snapshotDetail = isPlainObject(snapshotScore?.detail) ? snapshotScore.detail : {};
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
            detail: snapshotDetail,
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
