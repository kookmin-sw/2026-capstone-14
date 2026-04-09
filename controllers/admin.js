const asyncHandler = require('express-async-handler');
const { supabase } = require('../config/db');


// 대시보드
const getDashboard = asyncHandler(async (req, res) => {
    // 통계 데이터 조회
    const [exerciseCount, metricCount, profileCount, userCount] = await Promise.all([
        supabase.from('exercise').select('exercise_id', { count: 'exact', head: true }),
        supabase.from('metric').select('metric_id', { count: 'exact', head: true }),
        supabase.from('scoring_profile').select('scoring_profile_id', { count: 'exact', head: true }),
        supabase.from('app_user').select('user_id', { count: 'exact', head: true })
    ]);

    res.render('admin/dashboard', {
        title: '관리자 대시보드',
        layout: 'layouts/admin',
        activeTab: 'dashboard',
        stats: {
            exercises: exerciseCount.count || 0,
            metrics: metricCount.count || 0,
            profiles: profileCount.count || 0,
            users: userCount.count || 0
        }
    });
});


// 운동 관리
const getExercises = asyncHandler(async (req, res) => {
    const { data: exercises, error } = await supabase
        .from('exercise')
        .select('*')
        .order('name');

    if (error) {
        console.error('Exercise fetch error:', error);
    }

    res.render('admin/exercises', {
        title: '운동 관리',
        layout: 'layouts/admin',
        activeTab: 'exercises',
        exercises: exercises || [],
        success: req.query.success,
        error: req.query.error
    });
});

const createExercise = asyncHandler(async (req, res) => {
    const { code, name, description, is_active } = req.body;

    // 코드 형식 검증 (영문 대문자, 숫자, 밑줄만)
    if (!/^[A-Z0-9_]+$/.test(code)) {
        return res.redirect('/admin/exercises?error=코드는 영문 대문자, 숫자, 밑줄만 사용 가능합니다');
    }

    const { error } = await supabase
        .from('exercise')
        .insert({
            code: code.toUpperCase(),
            name,
            description: description || null,
            is_active: is_active === 'on'
        });

    if (error) {
        console.error('Exercise create error:', error);
        if (error.code === '23505') {
            return res.redirect('/admin/exercises?error=이미 존재하는 운동 코드입니다');
        }
        return res.redirect('/admin/exercises?error=운동 추가 중 오류가 발생했습니다');
    }

    res.redirect('/admin/exercises?success=운동이 추가되었습니다');
});

const updateExercise = asyncHandler(async (req, res) => {
    const { exercise_id } = req.params;
    const { code, name, description, is_active } = req.body;

    const { error } = await supabase
        .from('exercise')
        .update({
            code: code.toUpperCase(),
            name,
            description: description || null,
            is_active: is_active === 'on'
        })
        .eq('exercise_id', exercise_id);

    if (error) {
        console.error('Exercise update error:', error);
        return res.redirect('/admin/exercises?error=운동 수정 중 오류가 발생했습니다');
    }

    res.redirect('/admin/exercises?success=운동이 수정되었습니다');
});

const deleteExercise = asyncHandler(async (req, res) => {
    const { exercise_id } = req.params;

    const { error } = await supabase
        .from('exercise')
        .delete()
        .eq('exercise_id', exercise_id);

    if (error) {
        console.error('Exercise delete error:', error);
        if (error.code === '23503') {
            return res.redirect('/admin/exercises?error=이 운동을 사용하는 데이터가 있어 삭제할 수 없습니다');
        }
        return res.redirect('/admin/exercises?error=운동 삭제 중 오류가 발생했습니다');
    }

    res.redirect('/admin/exercises?success=운동이 삭제되었습니다');
});


// 채점 지표 관리
const getMetrics = asyncHandler(async (req, res) => {
    const { data: metrics, error } = await supabase
        .from('metric')
        .select('*')
        .order('title');

    if (error) {
        console.error('Metric fetch error:', error);
    }

    res.render('admin/metrics', {
        title: '채점 지표 관리',
        layout: 'layouts/admin',
        activeTab: 'metrics',
        metrics: metrics || [],
        success: req.query.success,
        error: req.query.error
    });
});

const createMetric = asyncHandler(async (req, res) => {
    const { key, title, description, unit } = req.body;

    const { error } = await supabase
        .from('metric')
        .insert({
            key,
            title,
            description: description || null,
            unit
        });

    if (error) {
        console.error('Metric create error:', error);
        if (error.code === '23505') {
            return res.redirect('/admin/metrics?error=이미 존재하는 지표 키입니다');
        }
        return res.redirect('/admin/metrics?error=지표 추가 중 오류가 발생했습니다');
    }

    res.redirect('/admin/metrics?success=지표가 추가되었습니다');
});

const updateMetric = asyncHandler(async (req, res) => {
    const { metric_id } = req.params;
    const { key, title, description, unit } = req.body;

    const { error } = await supabase
        .from('metric')
        .update({
            key,
            title,
            description: description || null,
            unit
        })
        .eq('metric_id', metric_id);

    if (error) {
        console.error('Metric update error:', error);
        return res.redirect('/admin/metrics?error=지표 수정 중 오류가 발생했습니다');
    }

    res.redirect('/admin/metrics?success=지표가 수정되었습니다');
});

const deleteMetric = asyncHandler(async (req, res) => {
    const { metric_id } = req.params;

    const { error } = await supabase
        .from('metric')
        .delete()
        .eq('metric_id', metric_id);

    if (error) {
        console.error('Metric delete error:', error);
        if (error.code === '23503') {
            return res.redirect('/admin/metrics?error=이 지표를 사용하는 프로파일이 있어 삭제할 수 없습니다');
        }
        return res.redirect('/admin/metrics?error=지표 삭제 중 오류가 발생했습니다');
    }

    res.redirect('/admin/metrics?success=지표가 삭제되었습니다');
});


// 채점 프로파일 관리
const getScoringProfiles = asyncHandler(async (req, res) => {
    const { data: profiles, error } = await supabase
        .from('scoring_profile')
        .select(`
            *,
            exercise:exercise_id (exercise_id, code, name)
        `)
        .order('created_at', { ascending: false });

    const { data: exercises } = await supabase
        .from('exercise')
        .select('exercise_id, code, name')
        .eq('is_active', true)
        .order('name');

    if (error) {
        console.error('Profile fetch error:', error);
    }

    res.render('admin/scoring', {
        title: '채점 프로파일 관리',
        layout: 'layouts/admin',
        activeTab: 'scoring',
        profiles: profiles || [],
        exercises: exercises || [],
        success: req.query.success,
        error: req.query.error
    });
});

const createScoringProfile = asyncHandler(async (req, res) => {
    const { exercise_id, name, is_active } = req.body;

    // 해당 운동의 최대 버전 조회
    const { data: maxVersion } = await supabase
        .from('scoring_profile')
        .select('version')
        .eq('exercise_id', exercise_id)
        .order('version', { ascending: false })
        .limit(1)
        .single();

    const newVersion = (maxVersion?.version || 0) + 1;

    // 활성화 시 기존 활성 프로파일 비활성화
    if (is_active === 'on') {
        await supabase
            .from('scoring_profile')
            .update({ is_active: false })
            .eq('exercise_id', exercise_id)
            .eq('is_active', true);
    }

    const { error } = await supabase
        .from('scoring_profile')
        .insert({
            exercise_id,
            version: newVersion,
            name,
            is_active: is_active === 'on'
        });

    if (error) {
        console.error('Profile create error:', error);
        return res.redirect('/admin/scoring?error=프로파일 추가 중 오류가 발생했습니다');
    }

    res.redirect('/admin/scoring?success=채점 프로파일이 추가되었습니다 (v' + newVersion + ')');
});

const getScoringProfileDetail = asyncHandler(async (req, res) => {
    const { profile_id } = req.params;

    const { data: profile, error } = await supabase
        .from('scoring_profile')
        .select(`
            *,
            exercise:exercise_id (exercise_id, code, name)
        `)
        .eq('scoring_profile_id', profile_id)
        .single();

    if (error || !profile) {
        return res.redirect('/admin/scoring?error=프로파일을 찾을 수 없습니다');
    }

    // 프로파일에 연결된 지표들 조회
    const { data: profileMetrics } = await supabase
        .from('scoring_profile_metric')
        .select(`
            *,
            metric:metric_id (metric_id, key, title, unit)
        `)
        .eq('scoring_profile_id', profile_id)
        .order('order_no');

    // 사용 가능한 모든 지표
    const { data: allMetrics } = await supabase
        .from('metric')
        .select('*')
        .order('title');

    res.render('admin/scoring-detail', {
        title: `채점 프로파일: ${profile.name}`,
        layout: 'layouts/admin',
        activeTab: 'scoring',
        profile,
        profileMetrics: profileMetrics || [],
        allMetrics: allMetrics || [],
        success: req.query.success,
        error: req.query.error
    });
});

const updateScoringProfile = asyncHandler(async (req, res) => {
    const { profile_id } = req.params;
    const { name, is_active } = req.body;

    // 현재 프로파일 정보 조회
    const { data: currentProfile } = await supabase
        .from('scoring_profile')
        .select('exercise_id')
        .eq('scoring_profile_id', profile_id)
        .single();

    // 활성화 시 기존 활성 프로파일 비활성화
    if (is_active === 'on' && currentProfile) {
        await supabase
            .from('scoring_profile')
            .update({ is_active: false })
            .eq('exercise_id', currentProfile.exercise_id)
            .eq('is_active', true)
            .neq('scoring_profile_id', profile_id);
    }

    const { error } = await supabase
        .from('scoring_profile')
        .update({
            name,
            is_active: is_active === 'on'
        })
        .eq('scoring_profile_id', profile_id);

    if (error) {
        console.error('Profile update error:', error);
        return res.redirect(`/admin/scoring/${profile_id}?error=프로파일 수정 중 오류가 발생했습니다`);
    }

    res.redirect(`/admin/scoring/${profile_id}?success=프로파일이 수정되었습니다`);
});

const deleteScoringProfile = asyncHandler(async (req, res) => {
    const { profile_id } = req.params;

    const { error } = await supabase
        .from('scoring_profile')
        .delete()
        .eq('scoring_profile_id', profile_id);

    if (error) {
        console.error('Profile delete error:', error);
        if (error.code === '23503') {
            return res.redirect('/admin/scoring?error=이 프로파일을 사용하는 세션이 있어 삭제할 수 없습니다');
        }
        return res.redirect('/admin/scoring?error=프로파일 삭제 중 오류가 발생했습니다');
    }

    res.redirect('/admin/scoring?success=프로파일이 삭제되었습니다');
});

// 프로파일 지표 추가/수정
const addProfileMetric = asyncHandler(async (req, res) => {
    const { profile_id } = req.params;
    const { metric_id, weight, max_score, order_no, rule } = req.body;

    // rule이 있으면 JSON 파싱
    let ruleJson = null;
    if (rule && rule.trim()) {
        try {
            ruleJson = JSON.parse(rule);
        } catch (e) {
            return res.redirect(`/admin/scoring/${profile_id}?error=규칙 JSON 형식이 올바르지 않습니다`);
        }
    }

    const { error } = await supabase
        .from('scoring_profile_metric')
        .upsert({
            scoring_profile_id: profile_id,
            metric_id,
            weight: parseFloat(weight),
            max_score: parseInt(max_score),
            order_no: parseInt(order_no),
            rule: ruleJson
        });

    if (error) {
        console.error('Profile metric add error:', error);
        if(error.code = '23505') return res.redirect(`/admin/scoring/${profile_id}?error=이미 존재하는 순서 번호입니다`);
        else return res.redirect(`/admin/scoring/${profile_id}?error=지표 추가 중 오류가 발생했습니다`);
    }

    res.redirect(`/admin/scoring/${profile_id}?success=지표가 추가되었습니다`);
});

const removeProfileMetric = asyncHandler(async (req, res) => {
    const { profile_id, metric_id } = req.params;

    const { error } = await supabase
        .from('scoring_profile_metric')
        .delete()
        .eq('scoring_profile_id', profile_id)
        .eq('metric_id', metric_id);

    if (error) {
        console.error('Profile metric remove error:', error);
        return res.redirect(`/admin/scoring/${profile_id}?error=지표 제거 중 오류가 발생했습니다`);
    }

    res.redirect(`/admin/scoring/${profile_id}?success=지표가 제거되었습니다`);
});


// 사용자 관리
const getUsers = asyncHandler(async (req, res) => {
    const { status, search } = req.query;
    
    let query = supabase
        .from('app_user')
        .select('user_id, login_id, nickname, status, created_at, last_login_at')
        .order('created_at', { ascending: false });
    
    // 상태 필터
    if (status && status !== 'all') {
        query = query.eq('status', status);
    }
    
    // 검색 필터
    if (search) {
        query = query.or(`login_id.ilike.%${search}%,nickname.ilike.%${search}%`);
    }
    
    const { data: users, error } = await query;

    if (error) {
        console.error('Users fetch error:', error);
    }

    // 상태별 통계
    const { data: statsData } = await supabase
        .from('app_user')
        .select('status');
    
    const stats = {
        total: statsData?.length || 0,
        active: statsData?.filter(u => u.status === 'active').length || 0,
        blocked: statsData?.filter(u => u.status === 'blocked').length || 0,
        deleted: statsData?.filter(u => u.status === 'deleted').length || 0
    };

    res.render('admin/users', {
        title: '사용자 관리',
        layout: 'layouts/admin',
        activeTab: 'users',
        users: users || [],
        stats,
        filters: { status: status || 'all', search: search || '' },
        success: req.query.success,
        error: req.query.error
    });
});

const updateUserStatus = asyncHandler(async (req, res) => {
    const { user_id } = req.params;
    const { status } = req.body;

    // 유효한 상태값인지 확인
    if (!['active', 'blocked', 'deleted'].includes(status)) {
        return res.redirect('/admin/users?error=유효하지 않은 상태값입니다');
    }

    // admin 계정은 상태 변경 불가
    const { data: user } = await supabase
        .from('app_user')
        .select('login_id')
        .eq('user_id', user_id)
        .single();

    if (user?.login_id === 'admin') {
        return res.redirect('/admin/users?error=관리자 계정은 상태를 변경할 수 없습니다');
    }

    const { error } = await supabase
        .from('app_user')
        .update({ status })
        .eq('user_id', user_id);

    if (error) {
        console.error('User status update error:', error);
        return res.redirect('/admin/users?error=상태 변경 중 오류가 발생했습니다');
    }

    const statusText = status === 'active' ? '활성화' : status === 'blocked' ? '차단' : '삭제';
    res.redirect(`/admin/users?success=사용자가 ${statusText}되었습니다`);
});


// ============ 퀘스트 템플릿 관리 ============

// 퀘스트 템플릿 목록
const getQuestTemplates = asyncHandler(async (req, res) => {
    const { data: templates, error } = await supabase
        .from('quest_template')
        .select('*')
        .order('scope')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Quest template fetch error:', error);
    }

    res.render('admin/quests', {
        title: '퀘스트 관리',
        layout: 'layouts/admin',
        activeTab: 'quests',
        templates: templates || [],
        success: req.query.success,
        error: req.query.error
    });
});

// 퀘스트 템플릿 생성
const createQuestTemplate = asyncHandler(async (req, res) => {
    const { scope, type, title, condition, reward_points, is_default, is_active } = req.body;

    // condition JSON 파싱
    let parsedCondition = {};
    try {
        if (condition) {
            parsedCondition = typeof condition === 'string' ? JSON.parse(condition) : condition;
        }
    } catch (e) {
        return res.redirect('/admin/quests?error=조건 형식이 올바르지 않습니다');
    }

    const { error } = await supabase
        .from('quest_template')
        .insert({
            scope,
            type,
            title,
            condition: parsedCondition,
            reward_points: parseInt(reward_points) || 0,
            is_default: is_default === 'on',
            is_active: is_active === 'on'
        });

    if (error) {
        console.error('Quest template create error:', error);
        return res.redirect('/admin/quests?error=퀘스트 생성 중 오류가 발생했습니다');
    }

    res.redirect('/admin/quests?success=퀘스트가 생성되었습니다');
});

// 퀘스트 템플릿 수정
const updateQuestTemplate = asyncHandler(async (req, res) => {
    const { quest_template_id } = req.params;
    const { scope, type, title, condition, reward_points, is_default, is_active } = req.body;

    // condition JSON 파싱
    let parsedCondition = {};
    try {
        if (condition) {
            parsedCondition = typeof condition === 'string' ? JSON.parse(condition) : condition;
        }
    } catch (e) {
        return res.redirect('/admin/quests?error=조건 형식이 올바르지 않습니다');
    }

    const { error } = await supabase
        .from('quest_template')
        .update({
            scope,
            type,
            title,
            condition: parsedCondition,
            reward_points: parseInt(reward_points) || 0,
            is_default: is_default === 'on',
            is_active: is_active === 'on',
            updated_at: new Date().toISOString()
        })
        .eq('quest_template_id', quest_template_id);

    if (error) {
        console.error('Quest template update error:', error);
        return res.redirect('/admin/quests?error=퀘스트 수정 중 오류가 발생했습니다');
    }

    res.redirect('/admin/quests?success=퀘스트가 수정되었습니다');
});

// 퀘스트 템플릿 삭제
const deleteQuestTemplate = asyncHandler(async (req, res) => {
    const { quest_template_id } = req.params;

    // 사용 중인 퀘스트가 있는지 확인
    const { count } = await supabase
        .from('user_quest')
        .select('user_quest_id', { count: 'exact', head: true })
        .eq('quest_template_id', quest_template_id);

    if (count > 0) {
        // 사용 중이면 비활성화만
        const { error } = await supabase
            .from('quest_template')
            .update({ is_active: false })
            .eq('quest_template_id', quest_template_id);

        if (error) {
            return res.redirect('/admin/quests?error=퀘스트 비활성화 중 오류가 발생했습니다');
        }
        return res.redirect('/admin/quests?success=사용 중인 퀘스트라 비활성화 처리되었습니다');
    }

    const { error } = await supabase
        .from('quest_template')
        .delete()
        .eq('quest_template_id', quest_template_id);

    if (error) {
        console.error('Quest template delete error:', error);
        return res.redirect('/admin/quests?error=퀘스트 삭제 중 오류가 발생했습니다');
    }

    res.redirect('/admin/quests?success=퀘스트가 삭제되었습니다');
});

// 티어 규칙 목록
const getTierRules = asyncHandler(async (req, res) => {
    const { data: tiers, error } = await supabase
        .from('tier_rule')
        .select('*')
        .order('tier');

    if (error) {
        console.error('Tier rule fetch error:', error);
    }

    res.render('admin/tiers', {
        title: '티어 관리',
        layout: 'layouts/admin',
        activeTab: 'tiers',
        tiers: tiers || [],
        success: req.query.success,
        error: req.query.error
    });
});

// 티어 규칙 생성/수정
const upsertTierRule = asyncHandler(async (req, res) => {
    const { tier, min_points, name } = req.body;

    const { error } = await supabase
        .from('tier_rule')
        .upsert({
            tier: parseInt(tier),
            min_points: parseInt(min_points),
            name
        });

    if (error) {
        console.error('Tier rule upsert error:', error);
        return res.redirect('/admin/tiers?error=티어 저장 중 오류가 발생했습니다');
    }

    res.redirect('/admin/tiers?success=티어가 저장되었습니다');
});

module.exports = {
    getDashboard,
    getExercises,
    createExercise,
    updateExercise,
    deleteExercise,
    getMetrics,
    createMetric,
    updateMetric,
    deleteMetric,
    getScoringProfiles,
    createScoringProfile,
    getScoringProfileDetail,
    updateScoringProfile,
    deleteScoringProfile,
    addProfileMetric,
    removeProfileMetric,
    getUsers,
    updateUserStatus,
    getQuestTemplates,
    createQuestTemplate,
    updateQuestTemplate,
    deleteQuestTemplate,
    getTierRules,
    upsertTierRule
};
