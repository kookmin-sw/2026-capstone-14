const { supabase } = require('../config/db');

const SESSION_STATUSES = ['DONE', 'ABORTED'];
const RESULT_BASIS_CODES = ['REPS', 'DURATION'];
const RESULT_UNIT_CODES = ['COUNT', 'SEC'];

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toRoundedNonNegativeInt = (value, fallback = 0) => {
    const parsed = toFiniteNumber(value, fallback);
    return Math.max(0, Math.round(parsed));
};

const normalizeResultBasis = (value) => {
    const basis = String(value || '').trim().toUpperCase();
    return RESULT_BASIS_CODES.includes(basis) ? basis : null;
};

const normalizeResultUnit = (value) => {
    const unit = String(value || '').trim().toUpperCase();
    return RESULT_UNIT_CODES.includes(unit) ? unit : null;
};

const computeDurationSecFromRange = (startedAtIso, endedAtIso = new Date().toISOString()) => {
    const startMs = new Date(startedAtIso).getTime();
    const endMs = new Date(endedAtIso).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
    return Math.max(0, Math.round((endMs - startMs) / 1000));
};

const getTodayRange = () => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const end = new Date(now);
    end.setHours(23, 59, 59, 999);

    return { start, end };
};

const getWeekRange = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
    monday.setHours(0, 0, 0, 0);

    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    return { start: monday, end: sunday };
};

const getPeriodRange = (period) => {
    const now = new Date();
    const normalized = String(period || 'all').trim().toLowerCase();

    if (normalized === 'today') {
        return getTodayRange();
    }

    if (normalized === 'week') {
        return getWeekRange();
    }

    if (normalized === 'month') {
        const start = new Date(now);
        start.setDate(1);
        start.setHours(0, 0, 0, 0);
        return { start, end: null };
    }

    if (normalized === '90d') {
        const start = new Date(now);
        start.setDate(start.getDate() - 89);
        start.setHours(0, 0, 0, 0);
        return { start, end: null };
    }

    return { start: null, end: null };
};

const mergeSessionResult = (session, snapshotScore = null) => {
    const mergedBasis =
        normalizeResultBasis(session?.result_basis) ||
        normalizeResultBasis(snapshotScore?.result_basis) ||
        'REPS';

    const mergedUnit =
        normalizeResultUnit(session?.total_result_unit) ||
        normalizeResultUnit(snapshotScore?.result_unit) ||
        (mergedBasis === 'REPS' ? 'COUNT' : 'SEC');

    const rawResultValue =
        session?.total_result_value ??
        snapshotScore?.result_value ??
        0;
    const totalResultValue = toRoundedNonNegativeInt(rawResultValue, 0);

    const rawScore = session?.final_score ?? snapshotScore?.score;
    const finalScore = Number.isFinite(Number(rawScore))
        ? Math.max(0, Math.min(100, Math.round(Number(rawScore))))
        : 0;

    const startedAt = session?.started_at || null;
    const endedAt = session?.ended_at || null;
    const durationSec = startedAt
        ? computeDurationSecFromRange(startedAt, endedAt || new Date().toISOString())
        : 0;

    const isRepBased = mergedBasis === 'REPS' || mergedUnit === 'COUNT';
    const totalReps = isRepBased ? totalResultValue : 0;
    const totalDurationResult = isRepBased ? 0 : totalResultValue;

    return {
        ...session,
        result_basis: mergedBasis,
        total_result_value: totalResultValue,
        total_result_unit: mergedUnit,
        final_score: finalScore,
        summary_feedback: session?.summary_feedback || snapshotScore?.summary_feedback || null,
        duration_sec: durationSec,
        total_reps: totalReps,
        total_duration_result: totalDurationResult
    };
};

const calculateStreak = (rows = []) => {
    if (!Array.isArray(rows) || rows.length === 0) return 0;

    const uniqueDates = [];
    const visited = new Set();

    for (const row of rows) {
        const date = new Date(row.started_at);
        if (Number.isNaN(date.getTime())) continue;
        const dateKey = date.toDateString();
        if (visited.has(dateKey)) continue;
        visited.add(dateKey);
        uniqueDates.push(new Date(dateKey));
    }

    if (uniqueDates.length === 0) return 0;

    const today = new Date();
    const todayDate = new Date(today.toDateString());
    const yesterdayDate = new Date(todayDate);
    yesterdayDate.setDate(todayDate.getDate() - 1);

    const firstDate = uniqueDates[0].toDateString();
    if (firstDate !== todayDate.toDateString() && firstDate !== yesterdayDate.toDateString()) {
        return 0;
    }

    let streak = 1;
    for (let index = 1; index < uniqueDates.length; index += 1) {
        const diffDays = Math.round((uniqueDates[index - 1] - uniqueDates[index]) / 86400000);
        if (diffDays === 1) {
            streak += 1;
        } else {
            break;
        }
    }

    return streak;
};

const buildPeriodStats = (rows = []) => {
    const normalized = rows.map((row) => mergeSessionResult(row));
    const count = normalized.length;
    const totalDurationSec = normalized.reduce((sum, row) => sum + (row.duration_sec || 0), 0);
    const totalMinutes = Math.round(totalDurationSec / 60);
    const totalReps = normalized.reduce((sum, row) => sum + (row.total_reps || 0), 0);
    const totalDurationResultSec = normalized.reduce((sum, row) => sum + (row.total_duration_result || 0), 0);

    const validScores = normalized
        .map((row) => Number(row.final_score))
        .filter((score) => Number.isFinite(score));

    const avgScore = validScores.length > 0
        ? Math.round(validScores.reduce((sum, score) => sum + score, 0) / validScores.length)
        : 0;

    return {
        count,
        totalMinutes,
        avgScore,
        totalReps,
        totalDurationSec: totalDurationResultSec
    };
};

const fetchFinalSnapshotMaps = async (sessionIds = []) => {
    if (!Array.isArray(sessionIds) || sessionIds.length === 0) {
        return {
            snapshotHeaderBySessionId: new Map(),
            snapshotScoreBySessionId: new Map()
        };
    }

    const { data: snapshotRows, error: snapshotError } = await supabase
        .from('session_snapshot')
        .select('session_id, session_snapshot_id, snapshot_no, recorded_at')
        .in('session_id', sessionIds)
        .eq('snapshot_type', 'FINAL')
        .order('session_id', { ascending: true })
        .order('snapshot_no', { ascending: false });

    if (snapshotError) throw snapshotError;

    const snapshotHeaderBySessionId = new Map();
    for (const row of snapshotRows || []) {
        if (!snapshotHeaderBySessionId.has(row.session_id)) {
            snapshotHeaderBySessionId.set(row.session_id, row);
        }
    }

    const snapshotIds = Array.from(snapshotHeaderBySessionId.values())
        .map((row) => row.session_snapshot_id)
        .filter(Boolean);

    if (snapshotIds.length === 0) {
        return {
            snapshotHeaderBySessionId,
            snapshotScoreBySessionId: new Map()
        };
    }

    const { data: scoreRows, error: scoreError } = await supabase
        .from('session_snapshot_score')
        .select('session_snapshot_id, score, result_basis, result_value, result_unit, summary_feedback, detail')
        .in('session_snapshot_id', snapshotIds);

    if (scoreError) throw scoreError;

    const scoreBySnapshotId = new Map(
        (scoreRows || []).map((row) => [row.session_snapshot_id, row])
    );

    const snapshotScoreBySessionId = new Map();
    for (const [sessionId, snapshotHeader] of snapshotHeaderBySessionId.entries()) {
        const snapshotScore = scoreBySnapshotId.get(snapshotHeader.session_snapshot_id) || null;
        if (snapshotScore) {
            snapshotScoreBySessionId.set(sessionId, snapshotScore);
        }
    }

    return {
        snapshotHeaderBySessionId,
        snapshotScoreBySessionId
    };
};

const loadRoutineContextBySetId = async (setId) => {
    if (!setId) return null;

    const context = {
        workout_set: null,
        step_instance: null,
        routine_instance: null,
        routine: null
    };

    const { data: workoutSet, error: setError } = await supabase
        .from('workout_set')
        .select(`
            set_id,
            step_instance_id,
            set_no,
            target_type,
            target_value,
            actual_value,
            value_unit,
            result_basis,
            score,
            is_success,
            duration_sec,
            rest_sec_after,
            status,
            started_at,
            ended_at,
            detail
        `)
        .eq('set_id', setId)
        .maybeSingle();

    if (setError) throw setError;
    context.workout_set = workoutSet || null;

    if (!workoutSet?.step_instance_id) return context;

    const { data: stepInstance, error: stepError } = await supabase
        .from('routine_step_instance')
        .select(`
            step_instance_id,
            routine_instance_id,
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
    context.step_instance = stepInstance || null;

    if (!stepInstance?.routine_instance_id) return context;

    const { data: routineInstance, error: routineInstanceError } = await supabase
        .from('routine_instance')
        .select(`
            routine_instance_id,
            routine_id,
            status,
            started_at,
            ended_at,
            total_score
        `)
        .eq('routine_instance_id', stepInstance.routine_instance_id)
        .maybeSingle();

    if (routineInstanceError) throw routineInstanceError;
    context.routine_instance = routineInstance || null;

    if (!routineInstance?.routine_id) return context;

    const { data: routine, error: routineError } = await supabase
        .from('routine')
        .select('routine_id, name')
        .eq('routine_id', routineInstance.routine_id)
        .maybeSingle();

    if (routineError) throw routineError;
    context.routine = routine || null;

    return context;
};

// 운동 히스토리 메인 페이지
const getHistoryPage = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const today = getTodayRange();
        const week = getWeekRange();

        const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
        const limit = 12;
        const offset = (page - 1) * limit;

        const requestedExercise = String(req.query.exercise || 'all');
        const parsedExerciseId = Number.parseInt(requestedExercise, 10);
        const exerciseIdFilter = Number.isFinite(parsedExerciseId) ? parsedExerciseId : null;

        const periodFilter = ['all', 'today', 'week', 'month', '90d'].includes(String(req.query.period || '').toLowerCase())
            ? String(req.query.period || 'all').toLowerCase()
            : 'all';

        const statusFilterRaw = String(req.query.status || 'DONE').trim().toUpperCase();
        const statusFilter = ['ALL', ...SESSION_STATUSES].includes(statusFilterRaw)
            ? statusFilterRaw
            : 'DONE';

        const sortFilterRaw = String(req.query.sort || 'latest').trim().toLowerCase();
        const sortFilter = ['latest', 'oldest', 'score'].includes(sortFilterRaw)
            ? sortFilterRaw
            : 'latest';

        const periodRange = getPeriodRange(periodFilter);

        let query = supabase
            .from('workout_session')
            .select(`
                session_id,
                mode,
                status,
                selected_view,
                set_id,
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
            `, { count: 'exact' })
            .eq('user_id', userId)
            .in('status', SESSION_STATUSES);

        if (exerciseIdFilter != null) {
            query = query.eq('exercise_id', exerciseIdFilter);
        }

        if (statusFilter !== 'ALL') {
            query = query.eq('status', statusFilter);
        }

        if (periodRange.start) {
            query = query.gte('started_at', periodRange.start.toISOString());
        }

        if (periodRange.end) {
            query = query.lte('started_at', periodRange.end.toISOString());
        }

        if (sortFilter === 'score') {
            query = query
                .order('final_score', { ascending: false, nullsFirst: false })
                .order('started_at', { ascending: false });
        } else if (sortFilter === 'oldest') {
            query = query.order('started_at', { ascending: true });
        } else {
            query = query.order('started_at', { ascending: false });
        }

        query = query.range(offset, offset + limit - 1);

        const { data: sessions, error: sessionsError, count } = await query;
        if (sessionsError) throw sessionsError;

        const { snapshotHeaderBySessionId, snapshotScoreBySessionId } = await fetchFinalSnapshotMaps(
            (sessions || []).map((row) => row.session_id)
        );

        const normalizedSessions = (sessions || []).map((session) => {
            const snapshotHeader = snapshotHeaderBySessionId.get(session.session_id) || null;
            const snapshotScore = snapshotScoreBySessionId.get(session.session_id) || null;
            const merged = mergeSessionResult(session, snapshotScore);

            return {
                ...merged,
                final_snapshot: snapshotHeader
                    ? {
                        session_snapshot_id: snapshotHeader.session_snapshot_id,
                        snapshot_no: snapshotHeader.snapshot_no,
                        recorded_at: snapshotHeader.recorded_at
                    }
                    : null
            };
        });

        const { data: exercises, error: exerciseError } = await supabase
            .from('exercise')
            .select('exercise_id, name')
            .eq('is_active', true)
            .order('name');
        if (exerciseError) throw exerciseError;

        const [
            { data: todaySessions, error: todayError },
            { data: weekSessions, error: weekError },
            { data: recentSessions, error: recentError },
            { count: totalDoneCount, error: totalDoneError },
            { count: totalAbortedCount, error: totalAbortedError },
            { data: bestSession, error: bestError },
            { data: streakRows, error: streakError }
        ] = await Promise.all([
            supabase
                .from('workout_session')
                .select('started_at, ended_at, final_score, result_basis, total_result_value, total_result_unit')
                .eq('user_id', userId)
                .eq('status', 'DONE')
                .gte('started_at', today.start.toISOString())
                .lte('started_at', today.end.toISOString()),
            supabase
                .from('workout_session')
                .select('started_at, ended_at, final_score, result_basis, total_result_value, total_result_unit')
                .eq('user_id', userId)
                .eq('status', 'DONE')
                .gte('started_at', week.start.toISOString())
                .lte('started_at', week.end.toISOString()),
            supabase
                .from('workout_session')
                .select('started_at, ended_at, final_score, result_basis, total_result_value, total_result_unit')
                .eq('user_id', userId)
                .eq('status', 'DONE')
                .gte('started_at', new Date(Date.now() - (29 * 86400000)).toISOString()),
            supabase
                .from('workout_session')
                .select('session_id', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('status', 'DONE'),
            supabase
                .from('workout_session')
                .select('session_id', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('status', 'ABORTED'),
            supabase
                .from('workout_session')
                .select('final_score, started_at, exercise:exercise_id(name)')
                .eq('user_id', userId)
                .eq('status', 'DONE')
                .order('final_score', { ascending: false, nullsFirst: false })
                .limit(1)
                .maybeSingle(),
            supabase
                .from('workout_session')
                .select('started_at')
                .eq('user_id', userId)
                .eq('status', 'DONE')
                .order('started_at', { ascending: false })
        ]);

        if (todayError) throw todayError;
        if (weekError) throw weekError;
        if (recentError) throw recentError;
        if (totalDoneError) throw totalDoneError;
        if (totalAbortedError) throw totalAbortedError;
        if (bestError) throw bestError;
        if (streakError) throw streakError;

        const todayStats = buildPeriodStats(todaySessions || []);
        const weekStats = buildPeriodStats(weekSessions || []);
        const recentStats = buildPeriodStats(recentSessions || []);
        const streak = calculateStreak(streakRows || []);

        const totalPages = Math.ceil((count || 0) / limit);

        res.render('history/index', {
            title: '운동 히스토리',
            activeTab: 'history',
            sessions: normalizedSessions,
            exercises: exercises || [],
            filters: {
                exercise: exerciseIdFilter != null ? String(exerciseIdFilter) : 'all',
                period: periodFilter,
                status: statusFilter,
                sort: sortFilter
            },
            pagination: {
                page,
                totalPages,
                total: count || 0
            },
            stats: {
                today: todayStats,
                week: weekStats,
                recent30: recentStats,
                overview: {
                    doneCount: totalDoneCount || 0,
                    abortedCount: totalAbortedCount || 0,
                    streak,
                    best: bestSession || null
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

// 세션 상세 조회 API
const getSessionDetail = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const sessionId = Number.parseInt(req.params.sessionId, 10);

        if (!Number.isFinite(sessionId)) {
            return res.status(400).json({ success: false, error: '유효하지 않은 세션 ID입니다.' });
        }

        const { data: session, error: sessionError } = await supabase
            .from('workout_session')
            .select(`
                session_id,
                mode,
                status,
                selected_view,
                set_id,
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
            .maybeSingle();

        if (sessionError) throw sessionError;
        if (!session) {
            return res.status(404).json({ success: false, error: '세션을 찾을 수 없습니다.' });
        }

        const { data: finalSnapshot, error: snapshotError } = await supabase
            .from('session_snapshot')
            .select('session_snapshot_id, snapshot_no, recorded_at')
            .eq('session_id', sessionId)
            .eq('snapshot_type', 'FINAL')
            .order('snapshot_no', { ascending: false })
            .limit(1)
            .maybeSingle();
        if (snapshotError) throw snapshotError;

        let snapshotScore = null;
        let snapshotMetrics = [];

        if (finalSnapshot?.session_snapshot_id) {
            const [{ data: scoreRow, error: scoreError }, { data: metricRows, error: metricError }] = await Promise.all([
                supabase
                    .from('session_snapshot_score')
                    .select('score, result_basis, result_value, result_unit, summary_feedback, detail')
                    .eq('session_snapshot_id', finalSnapshot.session_snapshot_id)
                    .maybeSingle(),
                supabase
                    .from('session_snapshot_metric')
                    .select('metric_key, metric_name, avg_score, avg_raw_value, min_raw_value, max_raw_value, sample_count, detail')
                    .eq('session_snapshot_id', finalSnapshot.session_snapshot_id)
            ]);

            if (scoreError) throw scoreError;
            if (metricError) throw metricError;

            snapshotScore = scoreRow || null;
            snapshotMetrics = metricRows || [];
        }

        const { data: sessionEvents, error: eventError } = await supabase
            .from('session_event')
            .select('event_id, event_time, type, payload')
            .eq('session_id', sessionId)
            .order('event_time', { ascending: false })
            .limit(100);
        if (eventError) throw eventError;

        const mergedSession = mergeSessionResult(session, snapshotScore);
        const detail = isPlainObject(snapshotScore?.detail) ? snapshotScore.detail : {};
        const timeline = Array.isArray(detail.score_timeline) ? detail.score_timeline : [];
        const repRecords = Array.isArray(detail.rep_records) ? detail.rep_records : [];
        const setRecords = Array.isArray(detail.set_records) ? detail.set_records : [];
        const detailEvents = Array.isArray(detail.events) ? detail.events : [];

        const sortedMetrics = [...snapshotMetrics].sort((a, b) => {
            const scoreDiff = toFiniteNumber(b.avg_score, 0) - toFiniteNumber(a.avg_score, 0);
            if (scoreDiff !== 0) return scoreDiff;
            return String(a.metric_name || '').localeCompare(String(b.metric_name || ''), 'ko');
        });

        const routineContext = await loadRoutineContextBySetId(mergedSession.set_id);

        return res.json({
            success: true,
            session: {
                ...mergedSession,
                final_snapshot: finalSnapshot
                    ? {
                        session_snapshot_id: finalSnapshot.session_snapshot_id,
                        snapshot_no: finalSnapshot.snapshot_no,
                        recorded_at: finalSnapshot.recorded_at
                    }
                    : null
            },
            metrics: sortedMetrics,
            timeline,
            rep_records: repRecords,
            set_records: setRecords,
            detail_events: detailEvents,
            session_events: sessionEvents || [],
            routine_context: routineContext,
            detail
        });
    } catch (error) {
        next(error);
    }
};

// 통계 데이터 API (차트용)
const getHistoryStats = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const parsedDays = Number.parseInt(req.query.days, 10);
        const safeDays = Number.isFinite(parsedDays)
            ? Math.min(Math.max(parsedDays, 7), 180)
            : 30;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (safeDays - 1));
        startDate.setHours(0, 0, 0, 0);

        const { data: sessions, error } = await supabase
            .from('workout_session')
            .select(`
                session_id,
                started_at,
                ended_at,
                final_score,
                result_basis,
                total_result_value,
                total_result_unit,
                mode,
                selected_view,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name
                )
            `)
            .eq('user_id', userId)
            .eq('status', 'DONE')
            .gte('started_at', startDate.toISOString())
            .order('started_at', { ascending: true });

        if (error) throw error;

        const dailyStats = {};
        const exerciseStats = {};

        for (const rawSession of sessions || []) {
            const session = mergeSessionResult(rawSession);
            const startedAt = new Date(session.started_at);
            if (Number.isNaN(startedAt.getTime())) continue;

            const dateKey = startedAt.toISOString().split('T')[0];

            if (!dailyStats[dateKey]) {
                dailyStats[dateKey] = {
                    date: dateKey,
                    count: 0,
                    totalMinutes: 0,
                    totalReps: 0,
                    totalResultSec: 0,
                    bestScore: 0,
                    scoreSamples: []
                };
            }

            dailyStats[dateKey].count += 1;
            dailyStats[dateKey].totalMinutes += Math.round((session.duration_sec || 0) / 60);
            dailyStats[dateKey].totalReps += session.total_reps || 0;
            dailyStats[dateKey].totalResultSec += session.total_duration_result || 0;
            dailyStats[dateKey].scoreSamples.push(session.final_score || 0);
            dailyStats[dateKey].bestScore = Math.max(dailyStats[dateKey].bestScore, session.final_score || 0);

            const exerciseName = session.exercise?.name || '기타';
            const exerciseCode = session.exercise?.code || 'etc';
            if (!exerciseStats[exerciseCode]) {
                exerciseStats[exerciseCode] = {
                    code: exerciseCode,
                    name: exerciseName,
                    count: 0,
                    totalMinutes: 0,
                    totalReps: 0,
                    totalResultSec: 0,
                    bestScore: 0,
                    scoreSamples: []
                };
            }

            exerciseStats[exerciseCode].count += 1;
            exerciseStats[exerciseCode].totalMinutes += Math.round((session.duration_sec || 0) / 60);
            exerciseStats[exerciseCode].totalReps += session.total_reps || 0;
            exerciseStats[exerciseCode].totalResultSec += session.total_duration_result || 0;
            exerciseStats[exerciseCode].bestScore = Math.max(exerciseStats[exerciseCode].bestScore, session.final_score || 0);
            exerciseStats[exerciseCode].scoreSamples.push(session.final_score || 0);
        }

        const daily = Object.values(dailyStats)
            .map((row) => ({
                date: row.date,
                count: row.count,
                totalMinutes: row.totalMinutes,
                totalReps: row.totalReps,
                totalResultSec: row.totalResultSec,
                bestScore: row.bestScore,
                avgScore: row.scoreSamples.length > 0
                    ? Math.round(row.scoreSamples.reduce((sum, score) => sum + score, 0) / row.scoreSamples.length)
                    : 0
            }))
            .sort((a, b) => a.date.localeCompare(b.date));

        const exercises = Object.values(exerciseStats)
            .map((row) => ({
                code: row.code,
                name: row.name,
                count: row.count,
                totalMinutes: row.totalMinutes,
                totalReps: row.totalReps,
                totalResultSec: row.totalResultSec,
                bestScore: row.bestScore,
                avgScore: row.scoreSamples.length > 0
                    ? Math.round(row.scoreSamples.reduce((sum, score) => sum + score, 0) / row.scoreSamples.length)
                    : 0
            }))
            .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return b.avgScore - a.avgScore;
            });

        return res.json({
            success: true,
            requestedDays: safeDays,
            daily,
            exercises
        });
    } catch (error) {
        next(error);
    }
};

// 세션 삭제
const deleteSession = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const sessionId = Number.parseInt(req.params.sessionId, 10);

        if (!Number.isFinite(sessionId)) {
            return res.status(400).json({ success: false, error: '유효하지 않은 세션 ID입니다.' });
        }

        const { data: session, error: checkError } = await supabase
            .from('workout_session')
            .select('session_id')
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .maybeSingle();

        if (checkError) throw checkError;
        if (!session) {
            return res.status(404).json({ success: false, error: '세션을 찾을 수 없습니다.' });
        }

        const { error: deleteError } = await supabase
            .from('workout_session')
            .delete()
            .eq('session_id', sessionId)
            .eq('user_id', userId);

        if (deleteError) throw deleteError;

        return res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getHistoryPage,
    getSessionDetail,
    getHistoryStats,
    deleteSession
};

