const { supabase } = require('../config/db');
const { buildQuestCardModel, refreshAllActiveQuestProgress } = require('./quest');

const RESULT_BASIS_CODES = ['REPS', 'DURATION'];
const RESULT_UNIT_CODES = ['COUNT', 'SEC'];
const ROUTINE_INSTANCE_STATUSES = ['RUNNING', 'DONE', 'ABORTED'];

const normalizeResultBasis = (value) => {
    const basis = String(value || '').trim().toUpperCase();
    return RESULT_BASIS_CODES.includes(basis) ? basis : null;
};

const normalizeResultUnit = (value) => {
    const unit = String(value || '').trim().toUpperCase();
    return RESULT_UNIT_CODES.includes(unit) ? unit : null;
};

const toSafeInt = (value, fallback = 0) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.round(parsed));
};

const clampScore = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, Math.round(parsed)));
};

const computeDurationSecFromRange = (startedAtIso, endedAtIso = new Date().toISOString()) => {
    const startMs = new Date(startedAtIso).getTime();
    const endMs = new Date(endedAtIso).getTime();
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 0;
    return Math.max(0, Math.round((endMs - startMs) / 1000));
};

const pad2 = (value) => String(value).padStart(2, '0');
const toLocalDateKey = (date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

const parseDateKey = (dateKey) => {
    const [year, month, day] = String(dateKey).split('-').map((v) => Number(v));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        return null;
    }
    return new Date(year, month - 1, day);
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

const normalizeSessionResult = (session) => {
    const basis = normalizeResultBasis(session?.result_basis) || 'REPS';
    const unit = normalizeResultUnit(session?.total_result_unit) || (basis === 'REPS' ? 'COUNT' : 'SEC');
    const resultValue = toSafeInt(session?.total_result_value, 0);
    const durationSec = computeDurationSecFromRange(session?.started_at, session?.ended_at || new Date().toISOString());
    const totalReps = basis === 'REPS' || unit === 'COUNT' ? resultValue : 0;
    const totalDurationResultSec = basis === 'DURATION' || unit === 'SEC' ? resultValue : 0;

    return {
        ...session,
        result_basis: basis,
        total_result_unit: unit,
        total_result_value: resultValue,
        duration_sec: durationSec,
        total_reps: totalReps,
        total_duration_result_sec: totalDurationResultSec,
        final_score: clampScore(session?.final_score)
    };
};

const aggregateSessionSummary = (sessions = []) => {
    const normalized = sessions.map((session) => normalizeSessionResult(session));
    const count = normalized.length;
    const totalMinutes = Math.round(normalized.reduce((sum, row) => sum + (row.duration_sec || 0), 0) / 60);
    const totalReps = normalized.reduce((sum, row) => sum + (row.total_reps || 0), 0);
    const totalDurationResultSec = normalized.reduce((sum, row) => sum + (row.total_duration_result_sec || 0), 0);
    const avgScore = count > 0
        ? Math.round(normalized.reduce((sum, row) => sum + (row.final_score || 0), 0) / count)
        : 0;

    return {
        count,
        totalMinutes,
        totalReps,
        totalDurationResultSec,
        avgScore
    };
};

const formatKoreanDate = () => {
    const now = new Date();
    return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
};

const calculateStreak = async (userId) => {
    try {
        const lookback = new Date();
        lookback.setDate(lookback.getDate() - 365);

        const { data: sessions, error } = await supabase
            .from('workout_session')
            .select('started_at')
            .eq('user_id', userId)
            .eq('status', 'DONE')
            .gte('started_at', lookback.toISOString())
            .order('started_at', { ascending: false });

        if (error || !sessions?.length) return 0;

        const uniqueKeys = [];
        const seen = new Set();
        for (const session of sessions) {
            const date = new Date(session.started_at);
            if (Number.isNaN(date.getTime())) continue;
            const key = toLocalDateKey(date);
            if (seen.has(key)) continue;
            seen.add(key);
            uniqueKeys.push(key);
        }

        if (!uniqueKeys.length) return 0;

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        const first = uniqueKeys[0];
        const firstDate = parseDateKey(first);
        if (!firstDate) return 0;
        if (toLocalDateKey(firstDate) !== toLocalDateKey(today) && toLocalDateKey(firstDate) !== toLocalDateKey(yesterday)) {
            return 0;
        }

        let streak = 1;
        for (let i = 1; i < uniqueKeys.length; i += 1) {
            const prevDate = parseDateKey(uniqueKeys[i - 1]);
            const currDate = parseDateKey(uniqueKeys[i]);
            if (!prevDate || !currDate) break;

            const diffDays = Math.round((prevDate - currDate) / 86400000);
            if (diffDays === 1) {
                streak += 1;
            } else {
                break;
            }
        }

        return streak;
    } catch (error) {
        console.error('Streak calculation error:', error);
        return 0;
    }
};

const getLast28DaysActivity = async (userId) => {
    try {
        const start = new Date();
        start.setDate(start.getDate() - 27);
        start.setHours(0, 0, 0, 0);

        const { data: sessions, error } = await supabase
            .from('workout_session')
            .select('started_at')
            .eq('user_id', userId)
            .eq('status', 'DONE')
            .gte('started_at', start.toISOString());
        if (error) throw error;

        const activeSet = new Set();
        (sessions || []).forEach((session) => {
            const startedAt = new Date(session.started_at);
            if (Number.isNaN(startedAt.getTime())) return;
            activeSet.add(toLocalDateKey(startedAt));
        });

        const days = [];
        for (let i = 27; i >= 0; i -= 1) {
            const date = new Date();
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() - i);
            const key = toLocalDateKey(date);
            days.push({
                date: key,
                hasWorkout: activeSet.has(key)
            });
        }

        return days;
    } catch (error) {
        console.error('Activity fetch error:', error);
        const fallback = [];
        for (let i = 27; i >= 0; i -= 1) {
            const date = new Date();
            date.setHours(0, 0, 0, 0);
            date.setDate(date.getDate() - i);
            fallback.push({ date: toLocalDateKey(date), hasWorkout: false });
        }
        return fallback;
    }
};

const buildRoutineStatsById = (instances = [], routineIds = []) => {
    const statsById = new Map(
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

    for (const instance of instances) {
        const routineId = instance.routine_id;
        if (!statsById.has(routineId)) continue;

        const stats = statsById.get(routineId);
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
            if (!Array.isArray(stats._scores)) stats._scores = [];
            stats._scores.push(score);
            stats.best_score = stats.best_score == null ? score : Math.max(stats.best_score, score);
        }
    }

    for (const stats of statsById.values()) {
        const scores = Array.isArray(stats._scores) ? stats._scores : [];
        stats.avg_score = scores.length > 0
            ? Math.round((scores.reduce((sum, score) => sum + score, 0) / scores.length) * 100) / 100
            : null;
        delete stats._scores;
    }

    return statsById;
};

const enrichQuickRoutines = async (userId, routines = []) => {
    const routineIds = routines.map((routine) => routine.routine_id);
    if (!routineIds.length) return [];

    const { data: instances, error } = await supabase
        .from('routine_instance')
        .select('routine_instance_id, routine_id, status, started_at, ended_at, total_score')
        .eq('user_id', userId)
        .in('routine_id', routineIds)
        .in('status', ROUTINE_INSTANCE_STATUSES)
        .order('started_at', { ascending: false });
    if (error) throw error;

    const statsById = buildRoutineStatsById(instances || [], routineIds);

    return routines.map((routine) => ({
        ...routine,
        step_count: Array.isArray(routine.routine_setup) ? routine.routine_setup.length : 0,
        runtime_stats: statsById.get(routine.routine_id) || {
            total_runs: 0,
            done_runs: 0,
            aborted_runs: 0,
            running_runs: 0,
            avg_score: null,
            best_score: null,
            last_run_at: null,
            last_status: null
        }
    }));
};

const getTierInfo = (pointsRows = [], tierRulesRows = []) => {
    const totalPoints = (pointsRows || []).reduce((sum, row) => sum + (Number(row.points) || 0), 0);

    const fallbackTiers = [
        { tier: 1, min_points: 0, name: '브론즈', emoji: '🥉' },
        { tier: 2, min_points: 300, name: '실버', emoji: '🥈' },
        { tier: 3, min_points: 1000, name: '골드', emoji: '🥇' },
        { tier: 4, min_points: 3000, name: '플래티넘', emoji: '💎' },
        { tier: 5, min_points: 10000, name: '다이아몬드', emoji: '👑' }
    ];

    const emojiByName = {
        브론즈: '🥉',
        실버: '🥈',
        골드: '🥇',
        플래티넘: '💎',
        다이아몬드: '👑'
    };

    const effectiveRules = (tierRulesRows || []).length > 0
        ? tierRulesRows.map((rule) => ({
            ...rule,
            emoji: emojiByName[rule.name] || '🏆'
        }))
        : fallbackTiers;

    let currentTier = effectiveRules[0];
    let nextTier = null;

    for (let i = effectiveRules.length - 1; i >= 0; i -= 1) {
        if (totalPoints >= (Number(effectiveRules[i].min_points) || 0)) {
            currentTier = effectiveRules[i];
            nextTier = i < effectiveRules.length - 1 ? effectiveRules[i + 1] : null;
            break;
        }
    }

    const currentMin = Number(currentTier.min_points) || 0;
    const nextMin = nextTier ? Number(nextTier.min_points) || currentMin : currentMin;
    const progress = nextTier
        ? Math.min(100, Math.round(((totalPoints - currentMin) / Math.max(1, nextMin - currentMin)) * 100))
        : 100;

    return {
        name: currentTier.name,
        emoji: currentTier.emoji || '🏆',
        points: totalPoints,
        nextTierName: nextTier?.name || null,
        pointsToNext: nextTier ? Math.max(0, nextMin - totalPoints) : 0,
        progress
    };
};

const getExerciseEmoji = (code) => {
    const normalized = String(code || '').trim().toLowerCase();
    const map = {
        squat: '🏋️',
        push_up: '💪',
        pushup: '💪',
        lunge: '🦵',
        plank: '🧘',
        burpee: '🔥',
        deadlift: '🏋️',
        shoulder_press: '🏐',
        bicep_curl: '💪'
    };
    return map[normalized] || '🎯';
};

// 홈페이지 렌더링 (로그인 사용자용)
const getHomePage = async (req, res, next) => {
    try {
        const isAuthenticated = res.locals.isAuthenticated;
        const user = res.locals.user;

        if (!isAuthenticated || !user) {
            return res.render('home', {
                title: 'Home',
                today: formatKoreanDate(),
                activeTab: 'home',
                streak: 0,
                todaySummary: { count: 0, totalMinutes: 0, totalReps: 0, totalDurationResultSec: 0, avgScore: 0 },
                weekSummary: { count: 0, totalMinutes: 0, totalReps: 0, totalDurationResultSec: 0, avgScore: 0 },
                dailyQuests: [],
                weeklyQuests: [],
                quickRoutines: [],
                routines: [],
                exercises: [],
                recentSessions: [],
                activityDays: Array.from({ length: 28 }).map(() => ({ date: '', hasWorkout: false })),
                tierInfo: null
            });
        }

        const userId = user.user_id;
        try {
            await refreshAllActiveQuestProgress(userId);
        } catch (questSyncError) {
            console.error('Home quest progress sync error:', questSyncError);
        }

        const todayRange = getTodayRange();
        const weekRange = getWeekRange();

        const [
            streak,
            activityDays,
            todaySessionsResult,
            weekSessionsResult,
            recentSessionsResult,
            dailyQuestsResult,
            weeklyQuestsResult,
            routinesResult,
            exercisesResult,
            pointsResult,
            tierRulesResult
        ] = await Promise.all([
            calculateStreak(userId),
            getLast28DaysActivity(userId),
            supabase
                .from('workout_session')
                .select('session_id, started_at, ended_at, final_score, result_basis, total_result_value, total_result_unit')
                .eq('user_id', userId)
                .eq('status', 'DONE')
                .gte('started_at', todayRange.start.toISOString())
                .lte('started_at', todayRange.end.toISOString()),
            supabase
                .from('workout_session')
                .select('session_id, started_at, ended_at, final_score, result_basis, total_result_value, total_result_unit')
                .eq('user_id', userId)
                .eq('status', 'DONE')
                .gte('started_at', weekRange.start.toISOString())
                .lte('started_at', weekRange.end.toISOString()),
            supabase
                .from('workout_session')
                .select(`
                    session_id,
                    started_at,
                    ended_at,
                    final_score,
                    result_basis,
                    total_result_value,
                    total_result_unit,
                    selected_view,
                    exercise:exercise_id (
                        exercise_id,
                        code,
                        name
                    )
                `)
                .eq('user_id', userId)
                .eq('status', 'DONE')
                .order('started_at', { ascending: false })
                .limit(5),
            supabase
                .from('user_quest')
                .select(`
                    user_quest_id,
                    progress,
                    status,
                    period_start,
                    period_end,
                    quest_template:quest_template_id (
                        quest_template_id,
                        title,
                        scope,
                        type,
                        condition,
                        reward_points
                    )
                `)
                .eq('user_id', userId)
                .in('status', ['ACTIVE', 'DONE'])
                .lte('period_start', todayRange.end.toISOString().split('T')[0])
                .gte('period_end', todayRange.start.toISOString().split('T')[0]),
            supabase
                .from('user_quest')
                .select(`
                    user_quest_id,
                    progress,
                    status,
                    period_start,
                    period_end,
                    quest_template:quest_template_id (
                        quest_template_id,
                        title,
                        scope,
                        type,
                        condition,
                        reward_points
                    )
                `)
                .eq('user_id', userId)
                .in('status', ['ACTIVE', 'DONE'])
                .lte('period_start', weekRange.end.toISOString().split('T')[0])
                .gte('period_end', weekRange.start.toISOString().split('T')[0]),
            supabase
                .from('routine')
                .select(`
                    routine_id,
                    name,
                    updated_at,
                    routine_setup (
                        step_id
                    )
                `)
                .eq('user_id', userId)
                .eq('is_active', true)
                .order('updated_at', { ascending: false })
                .limit(4),
            supabase
                .from('exercise')
                .select('exercise_id, code, name, default_target_type')
                .eq('is_active', true)
                .order('name'),
            supabase
                .from('point_ledger')
                .select('points')
                .eq('user_id', userId),
            supabase
                .from('tier_rule')
                .select('tier, min_points, name')
                .order('tier', { ascending: true })
        ]);

        if (todaySessionsResult.error) throw todaySessionsResult.error;
        if (weekSessionsResult.error) throw weekSessionsResult.error;
        if (recentSessionsResult.error) throw recentSessionsResult.error;
        if (dailyQuestsResult.error) throw dailyQuestsResult.error;
        if (weeklyQuestsResult.error) throw weeklyQuestsResult.error;
        if (routinesResult.error) throw routinesResult.error;
        if (exercisesResult.error) throw exercisesResult.error;
        if (pointsResult.error) throw pointsResult.error;
        if (tierRulesResult.error) throw tierRulesResult.error;

        const dailyQuests = (dailyQuestsResult.data || [])
            .filter((quest) => quest.quest_template?.scope === 'DAILY')
            .map(buildQuestCardModel);

        const weeklyQuests = (weeklyQuestsResult.data || [])
            .filter((quest) => quest.quest_template?.scope === 'WEEKLY')
            .map(buildQuestCardModel);

        const routines = routinesResult.data || [];
        const quickRoutines = await enrichQuickRoutines(userId, routines);

        const exercises = (exercisesResult.data || []).map((exercise) => ({
            ...exercise,
            emoji: getExerciseEmoji(exercise.code)
        }));

        const todaySummary = aggregateSessionSummary(todaySessionsResult.data || []);
        const weekSummary = aggregateSessionSummary(weekSessionsResult.data || []);

        const recentSessions = (recentSessionsResult.data || []).map((session) => normalizeSessionResult(session));

        const tierInfo = getTierInfo(pointsResult.data || [], tierRulesResult.data || []);

        return res.render('home', {
            title: 'Home',
            today: formatKoreanDate(),
            activeTab: 'home',
            streak,
            todaySummary,
            weekSummary,
            dailyQuests,
            weeklyQuests,
            quickRoutines,
            routines: quickRoutines,
            exercises,
            recentSessions,
            activityDays,
            tierInfo
        });
    } catch (error) {
        console.error('Home page error:', error);
        next(error);
    }
};

module.exports = {
    getHomePage,
    formatKoreanDate
};

