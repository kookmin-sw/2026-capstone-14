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

// 주간 범위 (월요일~일요일)
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

// 한국 날짜 형식
const formatKoreanDate = () => {
    const now = new Date();
    return `${now.getFullYear()}년 ${now.getMonth() + 1}월 ${now.getDate()}일`;
};

// 연속 운동일 계산
const calculateStreak = async (userId) => {
    try {
        // 최근 60일간의 운동 세션 날짜 가져오기
        const sixtyDaysAgo = new Date();
        sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
        
        const { data: sessions, error } = await supabase
            .from('workout_session')
            .select('started_at')
            .eq('user_id', userId)
            .not('ended_at', 'is', null)
            .gte('started_at', sixtyDaysAgo.toISOString())
            .order('started_at', { ascending: false });
        
        if (error || !sessions || sessions.length === 0) {
            return 0;
        }
        
        // 운동한 날짜들 (중복 제거)
        const workoutDates = new Set();
        sessions.forEach(session => {
            const date = new Date(session.started_at);
            const dateStr = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
            workoutDates.add(dateStr);
        });
        
        // 어제부터 연속일 계산
        let streak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // 오늘 운동했는지 확인
        const todayStr = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
        if (workoutDates.has(todayStr)) {
            streak = 1;
        }
        
        // 과거로 거슬러 올라가며 연속일 확인
        const checkDate = new Date(today);
        if (!workoutDates.has(todayStr)) {
            checkDate.setDate(checkDate.getDate() - 1);
        }
        
        for (let i = 0; i < 60; i++) {
            if (streak === 0 && !workoutDates.has(todayStr)) {
                // 오늘 운동 안했으면 어제부터 시작
                const yesterdayStr = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
                if (workoutDates.has(yesterdayStr)) {
                    streak = 1;
                    checkDate.setDate(checkDate.getDate() - 1);
                } else {
                    break;
                }
            } else {
                checkDate.setDate(checkDate.getDate() - 1);
                const dateStr = `${checkDate.getFullYear()}-${checkDate.getMonth()}-${checkDate.getDate()}`;
                if (workoutDates.has(dateStr)) {
                    streak++;
                } else {
                    break;
                }
            }
        }
        
        return streak;
    } catch (error) {
        console.error('Streak calculation error:', error);
        return 0;
    }
};

// 최근 28일 운동 기록 (출석 그리드용)
const getLast28DaysActivity = async (userId) => {
    try {
        const twentyEightDaysAgo = new Date();
        twentyEightDaysAgo.setDate(twentyEightDaysAgo.getDate() - 27);
        twentyEightDaysAgo.setHours(0, 0, 0, 0);
        
        const { data: sessions, error } = await supabase
            .from('workout_session')
            .select('started_at')
            .eq('user_id', userId)
            .not('ended_at', 'is', null)
            .gte('started_at', twentyEightDaysAgo.toISOString());
        
        if (error) throw error;
        
        // 운동한 날짜들 셋
        const workoutDates = new Set();
        sessions?.forEach(session => {
            const date = new Date(session.started_at);
            const dateStr = date.toISOString().split('T')[0];
            workoutDates.add(dateStr);
        });
        
        // 28일 배열 생성
        const days = [];
        for (let i = 27; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().split('T')[0];
            days.push({
                date: dateStr,
                hasWorkout: workoutDates.has(dateStr)
            });
        }
        
        return days;
    } catch (error) {
        console.error('Activity fetch error:', error);
        return Array(28).fill({ date: '', hasWorkout: false });
    }
};

// 홈페이지 렌더링 (로그인 사용자용)
const getHomePage = async (req, res, next) => {
    try {
        const isAuthenticated = res.locals.isAuthenticated;
        const user = res.locals.user;
        
        // 비로그인 사용자
        if (!isAuthenticated || !user) {
            return res.render('home', {
                title: 'Home',
                today: formatKoreanDate(),
                activeTab: 'home',
                streak: 0,
                todayMinutes: 0,
                dailyQuests: [],
                weeklyQuests: [],
                routines: [],
                exercises: [],
                activityDays: Array(28).fill({ date: '', hasWorkout: false }),
                tierInfo: null
            });
        }
        
        const userId = user.user_id;
        const today = getTodayRange();
        const week = getWeekRange();
        
        // 병렬로 데이터 가져오기
        const [
            streakResult,
            todaySessionsResult,
            dailyQuestsResult,
            weeklyQuestsResult,
            routinesResult,
            exercisesResult,
            pointsResult,
            tierRulesResult,
            activityDays
        ] = await Promise.all([
            // 연속 운동일
            calculateStreak(userId),
            
            // 오늘 운동 세션
            supabase
                .from('workout_session')
                .select('duration_sec, final_score')
                .eq('user_id', userId)
                .not('ended_at', 'is', null)
                .gte('started_at', today.start.toISOString())
                .lte('started_at', today.end.toISOString()),
            
            // 오늘의 퀘스트 (일일) - period_start/end로 오늘 날짜 포함 확인
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
                .lte('period_start', today.end.toISOString().split('T')[0])
                .gte('period_end', today.start.toISOString().split('T')[0]),
            
            // 주간 퀘스트 - 현재 주간 범위와 겹치는 퀘스트
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
                .lte('period_start', week.end.toISOString().split('T')[0])
                .gte('period_end', week.start.toISOString().split('T')[0]),
            
            // 사용자 루틴
            supabase
                .from('routine')
                .select('routine_id, name')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(3),
            
            // 활성 운동 목록
            supabase
                .from('exercise')
                .select('exercise_id, code, name')
                .eq('is_active', true)
                .order('name'),
            
            // 사용자 포인트 (points 컬럼 사용)
            supabase
                .from('point_ledger')
                .select('points')
                .eq('user_id', userId),
            
            // 티어 규칙 (tier 오름차순)
            supabase
                .from('tier_rule')
                .select('tier, min_points, name')
                .order('tier', { ascending: true }),
            
            // 28일 활동 기록
            getLast28DaysActivity(userId)
        ]);
        
        // 오늘 운동 통계
        let todayMinutes = 0;
        if (todaySessionsResult.data) {
            const totalSecs = todaySessionsResult.data.reduce((sum, s) => sum + (s.duration_sec || 0), 0);
            todayMinutes = Math.round(totalSecs / 60);
        }
        
        // 일일 퀘스트 처리 (scope === 'DAILY')
        const dailyQuests = (dailyQuestsResult.data || [])
            .filter(q => q.quest_template?.scope === 'DAILY')
            .map(q => {
                const condition = q.quest_template?.condition || {};
                const progress = q.progress || {};
                
                // condition에서 target 추출 (target 필드를 우선 확인)
                let target = condition.target || condition.count || condition.minutes || condition.score || condition.days || 1;
                let currentProgress = progress.current || progress.count || 0;
                let progressType = q.quest_template?.type; // DO, QUALITY, HABIT
                
                return {
                    questId: q.user_quest_id,
                    title: q.quest_template?.title || '퀘스트',
                    progress: currentProgress,
                    target: target,
                    progressType: progressType,
                    status: q.status,
                    reward: q.quest_template?.reward_points || 0,
                    condition: condition
                };
            });
        
        // 주간 퀘스트 처리 (scope === 'WEEKLY')
        const weeklyQuests = (weeklyQuestsResult.data || [])
            .filter(q => q.quest_template?.scope === 'WEEKLY')
            .map(q => {
                const condition = q.quest_template?.condition || {};
                const progress = q.progress || {};
                
                // condition에서 target 추출 (target 필드를 우선 확인)
                let target = condition.target || condition.count || condition.minutes || condition.score || condition.days || 1;
                let currentProgress = progress.current || progress.count || 0;
                let progressType = q.quest_template?.type;
                
                return {
                    questId: q.user_quest_id,
                    title: q.quest_template?.title || '퀘스트',
                    progress: currentProgress,
                    target: target,
                    progressType: progressType,
                    status: q.status,
                    reward: q.quest_template?.reward_points || 0,
                    condition: condition
                };
            });
        
        // 루틴
        const routines = routinesResult.data || [];
        
        // 운동 목록 (이모지 매핑)
        const exerciseEmoji = {
            'squat': '🏋️',
            'pushup': '💪',
            'lunge': '🦵',
            'plank': '🧘',
            'SQT': '🏋️',
            'PSH': '💪',
            'LNG': '🦵',
            'PLK': '🧘'
        };
        
        const exercises = (exercisesResult.data || []).map(e => ({
            ...e,
            emoji: exerciseEmoji[e.code] || '🎯'
        }));
        
        // 포인트 및 티어 계산 (points 컬럼 사용)
        const totalPoints = (pointsResult.data || []).reduce((sum, p) => sum + (p.points || 0), 0);
        const tierRules = tierRulesResult.data || [];
        
        // 기본 티어 설정 (tier_rule이 없을 때)
        const defaultTiers = [
            { tier: 1, name: '브론즈', emoji: '🥉', min_points: 0 },
            { tier: 2, name: '실버', emoji: '🥈', min_points: 300 },
            { tier: 3, name: '골드', emoji: '🥇', min_points: 1000 },
            { tier: 4, name: '플래티넘', emoji: '💎', min_points: 3000 },
            { tier: 5, name: '다이아몬드', emoji: '👑', min_points: 10000 }
        ];
        
        // tier_rule에 emoji가 없으므로 매핑
        const tierEmojis = {
            '브론즈': '🥉',
            '실버': '🥈',
            '골드': '🥇',
            '플래티넘': '💎',
            '다이아몬드': '👑'
        };
        
        // DB에서 가져온 티어에 emoji 추가
        const effectiveTierRules = tierRules.length > 0 
            ? tierRules.map(t => ({ ...t, emoji: tierEmojis[t.name] || '🏆' }))
            : defaultTiers;
        
        let currentTier = effectiveTierRules[0] || { name: '브론즈', emoji: '🥉', min_points: 0 };
        let nextTier = null;
        
        // 티어 찾기 (포인트 기준 내림차순으로 확인)
        for (let i = effectiveTierRules.length - 1; i >= 0; i--) {
            const rule = effectiveTierRules[i];
            if (totalPoints >= rule.min_points) {
                currentTier = rule;
                if (i < effectiveTierRules.length - 1) {
                    nextTier = effectiveTierRules[i + 1];
                }
                break;
            }
        }
        
        const tierInfo = {
            name: currentTier.name,
            emoji: currentTier.emoji || '🏆',
            points: totalPoints,
            nextTierName: nextTier?.name || null,
            pointsToNext: nextTier ? (nextTier.min_points - totalPoints) : 0,
            progress: nextTier 
                ? Math.min(100, Math.round(((totalPoints - currentTier.min_points) / (nextTier.min_points - currentTier.min_points)) * 100))
                : 100
        };
        
        res.render('home', {
            title: 'Home',
            today: formatKoreanDate(),
            activeTab: 'home',
            streak: streakResult,
            todayMinutes,
            dailyQuests,
            weeklyQuests,
            routines,
            exercises,
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
