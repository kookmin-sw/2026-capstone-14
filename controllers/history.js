const { supabase } = require('../config/db');

// 오늘 날짜 범위
const getTodayRange = () => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    
    const end = new Date(now);
    end.setHours(23, 59, 59, 999);
    
    return { start, end };
};

// 주간 범위
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

// 운동 히스토리 메인 페이지
const getHistoryPage = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const today = getTodayRange();
        const week = getWeekRange();
        
        // 페이지네이션
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        // 필터
        const { exercise, period, sort } = req.query;

        // 기본 쿼리
        let query = supabase
            .from('workout_session')
            .select(`
                session_id,
                mode,
                started_at,
                ended_at,
                duration_sec,
                total_reps,
                final_score,
                summary_feedback,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name
                )
            `, { count: 'exact' })
            .eq('user_id', userId)
            .not('ended_at', 'is', null);

        // 운동 필터
        if (exercise && exercise !== 'all') {
            query = query.eq('exercise_id', exercise);
        }

        // 기간 필터
        if (period === 'today') {
            query = query.gte('started_at', today.start.toISOString());
        } else if (period === 'week') {
            query = query.gte('started_at', week.start.toISOString());
        } else if (period === 'month') {
            const monthStart = new Date();
            monthStart.setDate(1);
            monthStart.setHours(0, 0, 0, 0);
            query = query.gte('started_at', monthStart.toISOString());
        }

        // 정렬
        if (sort === 'score') {
            query = query.order('final_score', { ascending: false });
        } else if (sort === 'duration') {
            query = query.order('duration_sec', { ascending: false });
        } else {
            query = query.order('started_at', { ascending: false });
        }

        // 페이지네이션 적용
        query = query.range(offset, offset + limit - 1);

        const { data: sessions, error, count } = await query;

        if (error) throw error;

        // 운동 목록 (필터용)
        const { data: exercises } = await supabase
            .from('exercise')
            .select('exercise_id, name')
            .eq('is_active', true)
            .order('name');

        // 통계 데이터 조회
        // 오늘 운동 횟수/시간
        const { data: todaySessions } = await supabase
            .from('workout_session')
            .select('duration_sec, final_score')
            .eq('user_id', userId)
            .gte('started_at', today.start.toISOString())
            .lte('started_at', today.end.toISOString())
            .not('ended_at', 'is', null);

        const todayStats = {
            count: todaySessions?.length || 0,
            totalMinutes: Math.round((todaySessions?.reduce((sum, s) => sum + (s.duration_sec || 0), 0) || 0) / 60),
            avgScore: todaySessions?.length 
                ? Math.round(todaySessions.reduce((sum, s) => sum + (s.final_score || 0), 0) / todaySessions.length)
                : 0
        };

        // 이번 주 통계
        const { data: weekSessions } = await supabase
            .from('workout_session')
            .select('started_at, duration_sec, final_score')
            .eq('user_id', userId)
            .gte('started_at', week.start.toISOString())
            .lte('started_at', week.end.toISOString())
            .not('ended_at', 'is', null);

        const uniqueWeekDays = new Set(
            (weekSessions || []).map(s => new Date(s.started_at).toDateString())
        ).size;

        const weekStats = {
            count: weekSessions?.length || 0,
            days: uniqueWeekDays,
            totalMinutes: Math.round((weekSessions?.reduce((sum, s) => sum + (s.duration_sec || 0), 0) || 0) / 60),
            avgScore: weekSessions?.length 
                ? Math.round(weekSessions.reduce((sum, s) => sum + (s.final_score || 0), 0) / weekSessions.length)
                : 0
        };

        // 전체 통계
        const { count: totalCount } = await supabase
            .from('workout_session')
            .select('session_id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .not('ended_at', 'is', null);

        // 최고 점수
        const { data: bestSession } = await supabase
            .from('workout_session')
            .select('final_score, started_at, exercise:exercise_id(name)')
            .eq('user_id', userId)
            .not('ended_at', 'is', null)
            .order('final_score', { ascending: false })
            .limit(1)
            .single();

        // 연속 운동 일수 계산
        const { data: allDates } = await supabase
            .from('workout_session')
            .select('started_at')
            .eq('user_id', userId)
            .not('ended_at', 'is', null)
            .order('started_at', { ascending: false });

        let streak = 0;
        if (allDates && allDates.length > 0) {
            const uniqueDates = [...new Set(allDates.map(s => 
                new Date(s.started_at).toDateString()
            ))].map(d => new Date(d));

            const todayStr = new Date().toDateString();
            const yesterdayStr = new Date(Date.now() - 86400000).toDateString();

            // 오늘 또는 어제 운동했는지 확인
            if (uniqueDates[0].toDateString() === todayStr || 
                uniqueDates[0].toDateString() === yesterdayStr) {
                streak = 1;
                for (let i = 1; i < uniqueDates.length; i++) {
                    const diff = (uniqueDates[i-1] - uniqueDates[i]) / 86400000;
                    if (diff === 1) {
                        streak++;
                    } else {
                        break;
                    }
                }
            }
        }

        // 총 페이지 수
        const totalPages = Math.ceil((count || 0) / limit);

        res.render('history/index', {
            title: '운동 히스토리',
            activeTab: 'history',
            sessions: sessions || [],
            exercises: exercises || [],
            filters: { exercise, period, sort },
            pagination: {
                page,
                totalPages,
                total: count || 0
            },
            stats: {
                today: todayStats,
                week: weekStats,
                total: totalCount || 0,
                streak,
                best: bestSession
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
        const { sessionId } = req.params;

        const { data: session, error } = await supabase
            .from('workout_session')
            .select(`
                session_id,
                mode,
                started_at,
                ended_at,
                duration_sec,
                total_reps,
                final_score,
                summary_feedback,
                detail,
                exercise:exercise_id (
                    exercise_id,
                    code,
                    name
                ),
                session_metric_result (
                    score,
                    raw,
                    metric:metric_id (
                        metric_id,
                        key,
                        title,
                        unit
                    )
                )
            `)
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .single();

        if (error || !session) {
            return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
        }

        const { data: workoutSets, error: setError } = await supabase
            .from('workout_set')
            .select('set_no, phase, target_reps, actual_reps, duration_sec, started_at, ended_at')
            .eq('session_id', sessionId)
            .order('set_no', { ascending: true })
            .order('started_at', { ascending: true });

        if (setError) throw setError;

        session.workout_sets = workoutSets || [];
        session.session_metric_result = (session.session_metric_result || []).sort((a, b) => {
            const aTitle = a.metric?.title || '';
            const bTitle = b.metric?.title || '';
            return aTitle.localeCompare(bTitle, 'ko');
        });

        res.json(session);
    } catch (error) {
        next(error);
    }
};

// 통계 데이터 API (차트용)
const getHistoryStats = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const { days = 30 } = req.query;
        const parsedDays = Number.parseInt(days, 10);
        const safeDays = Number.isFinite(parsedDays)
            ? Math.min(Math.max(parsedDays, 1), 180)
            : 30;

        const startDate = new Date();
        startDate.setDate(startDate.getDate() - (safeDays - 1));
        startDate.setHours(0, 0, 0, 0);

        const { data: sessions, error } = await supabase
            .from('workout_session')
            .select('started_at, duration_sec, final_score, total_reps, exercise:exercise_id(code, name)')
            .eq('user_id', userId)
            .gte('started_at', startDate.toISOString())
            .not('ended_at', 'is', null)
            .order('started_at');

        if (error) throw error;

        // 일별 집계
        const dailyStats = {};
        (sessions || []).forEach(session => {
            const date = new Date(session.started_at).toISOString().split('T')[0];
            if (!dailyStats[date]) {
                dailyStats[date] = {
                    date,
                    count: 0,
                    totalMinutes: 0,
                    totalReps: 0,
                    scores: [],
                    bestScore: null,
                    exercises: {}
                };
            }
            dailyStats[date].count++;
            dailyStats[date].totalMinutes += Math.round((session.duration_sec || 0) / 60);
            dailyStats[date].totalReps += session.total_reps || 0;
            if (typeof session.final_score === 'number') {
                dailyStats[date].scores.push(session.final_score);
                dailyStats[date].bestScore = dailyStats[date].bestScore === null
                    ? session.final_score
                    : Math.max(dailyStats[date].bestScore, session.final_score);
            }
            
            const exerciseName = session.exercise?.name || '기타';
            dailyStats[date].exercises[exerciseName] = (dailyStats[date].exercises[exerciseName] || 0) + 1;
        });

        // 평균 점수 계산
        Object.values(dailyStats).forEach(day => {
            day.avgScore = day.scores.length 
                ? Math.round(day.scores.reduce((a, b) => a + b, 0) / day.scores.length)
                : 0;
            day.bestScore = day.bestScore ?? 0;
            delete day.scores;
        });

        // 운동별 통계
        const exerciseStats = {};
        (sessions || []).forEach(session => {
            const name = session.exercise?.name || '기타';
            if (!exerciseStats[name]) {
                exerciseStats[name] = {
                    name,
                    count: 0,
                    totalMinutes: 0,
                    totalReps: 0,
                    avgScore: 0,
                    bestScore: 0,
                    scores: []
                };
            }
            exerciseStats[name].count++;
            exerciseStats[name].totalMinutes += Math.round((session.duration_sec || 0) / 60);
            exerciseStats[name].totalReps += session.total_reps || 0;
            if (typeof session.final_score === 'number') {
                exerciseStats[name].scores.push(session.final_score);
                exerciseStats[name].bestScore = Math.max(exerciseStats[name].bestScore, session.final_score);
            }
        });

        Object.values(exerciseStats).forEach(ex => {
            ex.avgScore = ex.scores.length 
                ? Math.round(ex.scores.reduce((a, b) => a + b, 0) / ex.scores.length)
                : 0;
            delete ex.scores;
        });

        res.json({
            daily: Object.values(dailyStats),
            exercises: Object.values(exerciseStats).sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count;
                return b.avgScore - a.avgScore;
            }),
            requestedDays: safeDays
        });
    } catch (error) {
        next(error);
    }
};

// 세션 삭제
const deleteSession = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const { sessionId } = req.params;

        // 세션 소유자 확인
        const { data: session, error: checkError } = await supabase
            .from('workout_session')
            .select('session_id')
            .eq('session_id', sessionId)
            .eq('user_id', userId)
            .single();

        if (checkError || !session) {
            return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
        }

        // 관련 데이터 삭제 (cascade가 설정되지 않은 경우)
        await supabase.from('session_metric_result').delete().eq('session_id', sessionId);
        await supabase.from('session_event').delete().eq('session_id', sessionId);
        await supabase.from('workout_set').delete().eq('session_id', sessionId);

        // 세션 삭제
        const { error } = await supabase
            .from('workout_session')
            .delete()
            .eq('session_id', sessionId);

        if (error) throw error;

        res.json({ success: true });
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
