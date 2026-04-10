const asyncHandler = require('express-async-handler');
const { supabase } = require('../config/db');
const { syncExerciseCatalog } = require('../config/exerciseCatalog');

const VIEW_CODES = ['FRONT', 'SIDE', 'DIAGONAL'];
const TARGET_TYPES = ['REPS', 'TIME'];
const QUEST_SCOPES = ['DAILY', 'WEEKLY'];
const QUEST_TYPES = ['DO', 'QUALITY', 'HABIT', 'CHALLENGE'];
const QUEST_DIFFICULTIES = ['EASY', 'NORMAL', 'HARD'];
const QUEST_CATEGORIES = ['GENERAL', 'DO', 'QUALITY', 'HABIT', 'CHALLENGE'];

const isChecked = (value) => value === 'on' || value === true || value === 'true';

const normalizeText = (value) => {
    const text = String(value ?? '').trim();
    return text.length > 0 ? text : null;
};

const parseIntOrDefault = (value, defaultValue = 0) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
};

const parseOptionalInt = (value) => {
    if (value === undefined || value === null || String(value).trim() === '') {
        return { valid: true, value: null };
    }

    const parsed = Number.parseInt(String(value), 10);
    if (Number.isNaN(parsed)) {
        return { valid: false, value: null };
    }

    return { valid: true, value: parsed };
};

const parseAllowedViews = (input) => {
    const rawValues = Array.isArray(input) ? input : [input];
    const normalized = rawValues
        .map((value) => String(value || '').trim().toUpperCase())
        .filter((value) => VIEW_CODES.includes(value));

    return [...new Set(normalized)];
};

const parseConditionJson = (condition) => {
    if (!condition) {
        return { ok: true, value: {} };
    }

    try {
        return {
            ok: true,
            value: typeof condition === 'string' ? JSON.parse(condition) : condition
        };
    } catch (error) {
        return { ok: false, value: {} };
    }
};

const normalizeUpperToken = (value, fallback = '') => {
    const token = String(value ?? '')
        .trim()
        .toUpperCase();
    return token || fallback;
};

const parseTierRange = (minTierInput, maxTierInput) => {
    const minTierParse = parseOptionalInt(minTierInput);
    const maxTierParse = parseOptionalInt(maxTierInput);

    if (!minTierParse.valid || !maxTierParse.valid) {
        return { ok: false, error: '티어 값은 비우거나 정수로 입력해야 합니다' };
    }

    if (minTierParse.value !== null && minTierParse.value < 1) {
        return { ok: false, error: '최소 티어는 1 이상의 정수여야 합니다' };
    }
    if (maxTierParse.value !== null && maxTierParse.value < 1) {
        return { ok: false, error: '최대 티어는 1 이상의 정수여야 합니다' };
    }
    if (
        minTierParse.value !== null &&
        maxTierParse.value !== null &&
        minTierParse.value > maxTierParse.value
    ) {
        return { ok: false, error: '최소 티어는 최대 티어보다 클 수 없습니다' };
    }

    return {
        ok: true,
        min_tier: minTierParse.value,
        max_tier: maxTierParse.value
    };
};

const buildAllowedViewRows = (exerciseId, allowedViews, defaultView) =>
    allowedViews.map((viewCode) => ({
        exercise_id: exerciseId,
        view_code: viewCode,
        is_default: viewCode === defaultView
    }));

const formatExerciseList = (exerciseRows = []) =>
    exerciseRows.map((exercise) => {
        const viewRows = Array.isArray(exercise.exercise_allowed_view)
            ? exercise.exercise_allowed_view
            : [];
        const orderedAllowedViews = VIEW_CODES.filter((code) =>
            viewRows.some((row) => row.view_code === code)
        );
        const unknownViews = viewRows
            .map((row) => row.view_code)
            .filter((viewCode) => !orderedAllowedViews.includes(viewCode));
        const allowedViews = [...orderedAllowedViews, ...unknownViews];
        const defaultView =
            viewRows.find((row) => row.is_default)?.view_code || allowedViews[0] || null;

        return {
            ...exercise,
            allowed_views: allowedViews,
            default_view: defaultView
        };
    });

const normalizeExercisePayload = (body) => {
    const code = String(body.code || '').trim().toUpperCase();
    const name = String(body.name || '').trim();
    const defaultTargetType = String(body.default_target_type || '')
        .trim()
        .toUpperCase();
    const allowedViews = parseAllowedViews(body.allowed_views);
    let defaultView = String(body.default_view || '').trim().toUpperCase();

    if (!allowedViews.includes(defaultView)) {
        defaultView = allowedViews[0] || null;
    }

    return {
        code,
        name,
        description: normalizeText(body.description),
        is_active: isChecked(body.is_active),
        sort_order: parseIntOrDefault(body.sort_order, 0),
        default_target_type: defaultTargetType,
        thumbnail_url: normalizeText(body.thumbnail_url),
        allowed_views: allowedViews,
        default_view: defaultView
    };
};

const validateExercisePayload = (payload) => {
    if (!/^[A-Z0-9_]+$/.test(payload.code)) {
        return '코드는 영문 대문자, 숫자, 밑줄만 사용 가능합니다';
    }

    if (!payload.name) {
        return '운동 이름은 필수입니다';
    }

    if (!TARGET_TYPES.includes(payload.default_target_type)) {
        return '기본 목표 타입은 REPS 또는 TIME만 가능합니다';
    }

    if (payload.allowed_views.length === 0) {
        return '허용 자세를 최소 1개 이상 선택해주세요';
    }

    return null;
};


// 대시보드
const getDashboard = asyncHandler(async (req, res) => {
    const [exerciseCount, allowedViewCount, questCount, userCount] = await Promise.all([
        supabase.from('exercise').select('exercise_id', { count: 'exact', head: true }),
        supabase.from('exercise_allowed_view').select('exercise_id', { count: 'exact', head: true }),
        supabase.from('quest_template').select('quest_template_id', { count: 'exact', head: true }),
        supabase.from('app_user').select('user_id', { count: 'exact', head: true })
    ]);

    res.render('admin/dashboard', {
        title: '관리자 대시보드',
        layout: 'layouts/admin',
        activeTab: 'dashboard',
        stats: {
            exercises: exerciseCount.count || 0,
            allowedViews: allowedViewCount.count || 0,
            quests: questCount.count || 0,
            users: userCount.count || 0
        }
    });
});


// 운동 관리
const getExercises = asyncHandler(async (req, res) => {
    await syncExerciseCatalog();

    const [{ data: exerciseRows, error: exerciseError }, { data: allowedViewRows, error: allowedViewError }] =
        await Promise.all([
            supabase
                .from('exercise')
                .select('*')
                .order('sort_order', { ascending: true })
                .order('name', { ascending: true }),
            supabase.from('exercise_allowed_view').select('exercise_id, view_code, is_default')
        ]);

    if (exerciseError) {
        console.error('Exercise fetch error:', exerciseError);
    }
    if (allowedViewError) {
        console.error('Exercise allowed view fetch error:', allowedViewError);
    }

    const viewMap = new Map();
    (allowedViewRows || []).forEach((row) => {
        if (!viewMap.has(row.exercise_id)) {
            viewMap.set(row.exercise_id, []);
        }
        viewMap.get(row.exercise_id).push(row);
    });

    const mergedRows = (exerciseRows || []).map((exercise) => ({
        ...exercise,
        exercise_allowed_view: viewMap.get(exercise.exercise_id) || []
    }));

    res.render('admin/exercises', {
        title: '운동 관리',
        layout: 'layouts/admin',
        activeTab: 'exercises',
        exercises: formatExerciseList(mergedRows),
        viewCodes: VIEW_CODES,
        targetTypes: TARGET_TYPES,
        success: req.query.success,
        error: req.query.error
    });
});

const createExercise = asyncHandler(async (req, res) => {
    const payload = normalizeExercisePayload(req.body);
    const validationError = validateExercisePayload(payload);
    if (validationError) {
        return res.redirect(`/admin/exercises?error=${encodeURIComponent(validationError)}`);
    }

    const { data: createdExercise, error: createError } = await supabase
        .from('exercise')
        .insert({
            code: payload.code,
            name: payload.name,
            description: payload.description,
            is_active: payload.is_active,
            sort_order: payload.sort_order,
            default_target_type: payload.default_target_type,
            thumbnail_url: payload.thumbnail_url
        })
        .select('exercise_id')
        .single();

    if (createError) {
        console.error('Exercise create error:', createError);
        if (createError.code === '23505') {
            return res.redirect('/admin/exercises?error=이미 존재하는 운동 코드입니다');
        }
        return res.redirect('/admin/exercises?error=운동 추가 중 오류가 발생했습니다');
    }

    const viewRows = buildAllowedViewRows(
        createdExercise.exercise_id,
        payload.allowed_views,
        payload.default_view
    );

    const { error: viewInsertError } = await supabase
        .from('exercise_allowed_view')
        .insert(viewRows);

    if (viewInsertError) {
        console.error('Exercise allowed view create error:', viewInsertError);
        await supabase.from('exercise').delete().eq('exercise_id', createdExercise.exercise_id);
        return res.redirect('/admin/exercises?error=운동은 생성되었지만 허용 자세 저장에 실패했습니다');
    }

    res.redirect('/admin/exercises?success=운동이 추가되었습니다');
});

const updateExercise = asyncHandler(async (req, res) => {
    const { exercise_id } = req.params;
    const payload = normalizeExercisePayload(req.body);
    const validationError = validateExercisePayload(payload);
    if (validationError) {
        return res.redirect(`/admin/exercises?error=${encodeURIComponent(validationError)}`);
    }

    const { data: existingViews } = await supabase
        .from('exercise_allowed_view')
        .select('view_code, is_default')
        .eq('exercise_id', exercise_id);

    const { error: updateError } = await supabase
        .from('exercise')
        .update({
            code: payload.code,
            name: payload.name,
            description: payload.description,
            is_active: payload.is_active,
            sort_order: payload.sort_order,
            default_target_type: payload.default_target_type,
            thumbnail_url: payload.thumbnail_url,
            updated_at: new Date().toISOString()
        })
        .eq('exercise_id', exercise_id);

    if (updateError) {
        console.error('Exercise update error:', updateError);
        if (updateError.code === '23505') {
            return res.redirect('/admin/exercises?error=이미 존재하는 운동 코드입니다');
        }
        return res.redirect('/admin/exercises?error=운동 수정 중 오류가 발생했습니다');
    }

    const { error: viewDeleteError } = await supabase
        .from('exercise_allowed_view')
        .delete()
        .eq('exercise_id', exercise_id);

    if (viewDeleteError) {
        console.error('Exercise allowed view delete error:', viewDeleteError);
        return res.redirect('/admin/exercises?error=허용 자세 갱신 중 오류가 발생했습니다');
    }

    const { error: viewInsertError } = await supabase
        .from('exercise_allowed_view')
        .insert(buildAllowedViewRows(exercise_id, payload.allowed_views, payload.default_view));

    if (viewInsertError) {
        console.error('Exercise allowed view insert error:', viewInsertError);

        if (Array.isArray(existingViews) && existingViews.length > 0) {
            await supabase.from('exercise_allowed_view').insert(
                existingViews.map((viewRow) => ({
                    exercise_id,
                    view_code: viewRow.view_code,
                    is_default: viewRow.is_default
                }))
            );
        }

        return res.redirect('/admin/exercises?error=허용 자세 저장 중 오류가 발생했습니다');
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


// 사용자 관리
const getUsers = asyncHandler(async (req, res) => {
    const { status, search } = req.query;

    let query = supabase
        .from('app_user')
        .select('user_id, login_id, nickname, status, created_at, last_login_at')
        .order('created_at', { ascending: false });

    if (status && status !== 'all') {
        query = query.eq('status', status);
    }

    if (search) {
        query = query.or(`login_id.ilike.%${search}%,nickname.ilike.%${search}%`);
    }

    const { data: users, error } = await query;

    if (error) {
        console.error('Users fetch error:', error);
    }

    const { data: statsData } = await supabase.from('app_user').select('status');

    const stats = {
        total: statsData?.length || 0,
        active: statsData?.filter((user) => user.status === 'active').length || 0,
        blocked: statsData?.filter((user) => user.status === 'blocked').length || 0,
        deleted: statsData?.filter((user) => user.status === 'deleted').length || 0
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

    if (!['active', 'blocked', 'deleted'].includes(status)) {
        return res.redirect('/admin/users?error=유효하지 않은 상태값입니다');
    }

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


// 퀘스트 템플릿 관리
const getQuestTemplates = asyncHandler(async (req, res) => {
    const [
        { data: templates, error: templateError },
        { data: tiers, error: tierError },
        { data: assignmentRules, error: ruleError }
    ] = await Promise.all([
        supabase
            .from('quest_template')
            .select('*')
            .order('scope', { ascending: true })
            .order('created_at', { ascending: false }),
        supabase.from('tier_rule').select('tier, name').order('tier'),
        supabase
            .from('quest_assignment_rule')
            .select('*')
            .order('scope', { ascending: true })
            .order('slot_no', { ascending: true })
            .order('rule_id', { ascending: false })
    ]);

    if (templateError) {
        console.error('Quest template fetch error:', templateError);
    }
    if (tierError) {
        console.error('Tier rule fetch error:', tierError);
    }
    if (ruleError) {
        console.error('Quest assignment rule fetch error:', ruleError);
    }

    const categorySet = new Set(QUEST_CATEGORIES);
    (templates || []).forEach((template) => {
        if (template.category) {
            categorySet.add(String(template.category).toUpperCase());
        }
    });
    (assignmentRules || []).forEach((rule) => {
        if (rule.category) {
            categorySet.add(String(rule.category).toUpperCase());
        }
    });

    res.render('admin/quests', {
        title: '퀘스트 관리',
        layout: 'layouts/admin',
        activeTab: 'quests',
        templates: templates || [],
        assignmentRules: assignmentRules || [],
        tiers: tiers || [],
        questScopes: QUEST_SCOPES,
        questTypes: QUEST_TYPES,
        questDifficulties: QUEST_DIFFICULTIES,
        questCategories: [...categorySet].sort(),
        success: req.query.success,
        error: req.query.error
    });
});

const createQuestTemplate = asyncHandler(async (req, res) => {
    const scope = normalizeUpperToken(req.body.scope);
    const type = normalizeUpperToken(req.body.type);
    const categoryInput = normalizeUpperToken(req.body.category);
    const category = categoryInput || (type === 'DO' ? 'GENERAL' : type);
    const difficulty = normalizeUpperToken(req.body.difficulty, 'NORMAL');
    const title = String(req.body.title || '').trim();
    const rewardPoints = parseIntOrDefault(req.body.reward_points, NaN);
    const selectionWeight = parseIntOrDefault(req.body.selection_weight, NaN);
    const cooldownDays = parseIntOrDefault(req.body.cooldown_days, NaN);
    const exclusiveGroup = normalizeText(req.body.exclusive_group);
    const conditionParse = parseConditionJson(req.body.condition);
    const tierRange = parseTierRange(req.body.min_tier, req.body.max_tier);

    if (!QUEST_SCOPES.includes(scope)) {
        return res.redirect('/admin/quests?error=유효하지 않은 퀘스트 범위입니다');
    }
    if (!QUEST_TYPES.includes(type)) {
        return res.redirect('/admin/quests?error=유효하지 않은 퀘스트 유형입니다');
    }
    if (!QUEST_DIFFICULTIES.includes(difficulty)) {
        return res.redirect('/admin/quests?error=난이도는 EASY/NORMAL/HARD 중 하나여야 합니다');
    }
    if (!/^[A-Z0-9_]{1,30}$/.test(category)) {
        return res.redirect('/admin/quests?error=카테고리는 영문 대문자/숫자/_ 조합으로 입력해주세요');
    }
    if (!title) {
        return res.redirect('/admin/quests?error=퀘스트 제목은 필수입니다');
    }
    if (!Number.isFinite(rewardPoints) || rewardPoints < 0) {
        return res.redirect('/admin/quests?error=보상 포인트는 0 이상이어야 합니다');
    }
    if (!Number.isFinite(selectionWeight) || selectionWeight <= 0) {
        return res.redirect('/admin/quests?error=선발 가중치는 1 이상의 정수여야 합니다');
    }
    if (!Number.isFinite(cooldownDays) || cooldownDays < 0) {
        return res.redirect('/admin/quests?error=쿨다운 일수는 0 이상의 정수여야 합니다');
    }
    if (!conditionParse.ok) {
        return res.redirect('/admin/quests?error=조건 JSON 형식이 올바르지 않습니다');
    }
    if (!tierRange.ok) {
        return res.redirect(`/admin/quests?error=${encodeURIComponent(tierRange.error)}`);
    }

    const { error } = await supabase
        .from('quest_template')
        .insert({
            scope,
            type,
            category,
            difficulty,
            title,
            condition: conditionParse.value,
            reward_points: rewardPoints,
            min_tier: tierRange.min_tier,
            max_tier: tierRange.max_tier,
            selection_weight: selectionWeight,
            cooldown_days: cooldownDays,
            exclusive_group: exclusiveGroup,
            is_active: isChecked(req.body.is_active)
        });

    if (error) {
        console.error('Quest template create error:', error);
        if (error.code === '23503') {
            return res.redirect('/admin/quests?error=존재하지 않는 티어 값이 포함되어 있습니다');
        }
        return res.redirect('/admin/quests?error=퀘스트 생성 중 오류가 발생했습니다');
    }

    res.redirect('/admin/quests?success=퀘스트가 생성되었습니다');
});

const updateQuestTemplate = asyncHandler(async (req, res) => {
    const { quest_template_id } = req.params;
    const scope = normalizeUpperToken(req.body.scope);
    const type = normalizeUpperToken(req.body.type);
    const categoryInput = normalizeUpperToken(req.body.category);
    const category = categoryInput || (type === 'DO' ? 'GENERAL' : type);
    const difficulty = normalizeUpperToken(req.body.difficulty, 'NORMAL');
    const title = String(req.body.title || '').trim();
    const rewardPoints = parseIntOrDefault(req.body.reward_points, NaN);
    const selectionWeight = parseIntOrDefault(req.body.selection_weight, NaN);
    const cooldownDays = parseIntOrDefault(req.body.cooldown_days, NaN);
    const exclusiveGroup = normalizeText(req.body.exclusive_group);
    const conditionParse = parseConditionJson(req.body.condition);
    const tierRange = parseTierRange(req.body.min_tier, req.body.max_tier);

    if (!QUEST_SCOPES.includes(scope)) {
        return res.redirect('/admin/quests?error=유효하지 않은 퀘스트 범위입니다');
    }
    if (!QUEST_TYPES.includes(type)) {
        return res.redirect('/admin/quests?error=유효하지 않은 퀘스트 유형입니다');
    }
    if (!QUEST_DIFFICULTIES.includes(difficulty)) {
        return res.redirect('/admin/quests?error=난이도는 EASY/NORMAL/HARD 중 하나여야 합니다');
    }
    if (!/^[A-Z0-9_]{1,30}$/.test(category)) {
        return res.redirect('/admin/quests?error=카테고리는 영문 대문자/숫자/_ 조합으로 입력해주세요');
    }
    if (!title) {
        return res.redirect('/admin/quests?error=퀘스트 제목은 필수입니다');
    }
    if (!Number.isFinite(rewardPoints) || rewardPoints < 0) {
        return res.redirect('/admin/quests?error=보상 포인트는 0 이상이어야 합니다');
    }
    if (!Number.isFinite(selectionWeight) || selectionWeight <= 0) {
        return res.redirect('/admin/quests?error=선발 가중치는 1 이상의 정수여야 합니다');
    }
    if (!Number.isFinite(cooldownDays) || cooldownDays < 0) {
        return res.redirect('/admin/quests?error=쿨다운 일수는 0 이상의 정수여야 합니다');
    }
    if (!conditionParse.ok) {
        return res.redirect('/admin/quests?error=조건 JSON 형식이 올바르지 않습니다');
    }
    if (!tierRange.ok) {
        return res.redirect(`/admin/quests?error=${encodeURIComponent(tierRange.error)}`);
    }

    const { error } = await supabase
        .from('quest_template')
        .update({
            scope,
            type,
            category,
            difficulty,
            title,
            condition: conditionParse.value,
            reward_points: rewardPoints,
            min_tier: tierRange.min_tier,
            max_tier: tierRange.max_tier,
            selection_weight: selectionWeight,
            cooldown_days: cooldownDays,
            exclusive_group: exclusiveGroup,
            is_active: isChecked(req.body.is_active),
            updated_at: new Date().toISOString()
        })
        .eq('quest_template_id', quest_template_id);

    if (error) {
        console.error('Quest template update error:', error);
        if (error.code === '23503') {
            return res.redirect('/admin/quests?error=존재하지 않는 티어 값이 포함되어 있습니다');
        }
        return res.redirect('/admin/quests?error=퀘스트 수정 중 오류가 발생했습니다');
    }

    res.redirect('/admin/quests?success=퀘스트가 수정되었습니다');
});

const deleteQuestTemplate = asyncHandler(async (req, res) => {
    const { quest_template_id } = req.params;

    const { count } = await supabase
        .from('user_quest')
        .select('user_quest_id', { count: 'exact', head: true })
        .eq('quest_template_id', quest_template_id);

    if (count > 0) {
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

// 퀘스트 슬롯 규칙 관리
const createQuestAssignmentRule = asyncHandler(async (req, res) => {
    const scope = normalizeUpperToken(req.body.scope);
    const slotNo = parseIntOrDefault(req.body.slot_no, NaN);
    const category = normalizeUpperToken(req.body.category);
    const type = normalizeUpperToken(req.body.type);
    const count = parseIntOrDefault(req.body.count, NaN);
    const tierRange = parseTierRange(req.body.min_tier, req.body.max_tier);

    if (!QUEST_SCOPES.includes(scope)) {
        return res.redirect('/admin/quests?error=유효하지 않은 규칙 범위입니다');
    }
    if (!Number.isFinite(slotNo) || slotNo < 1) {
        return res.redirect('/admin/quests?error=슬롯 번호는 1 이상의 정수여야 합니다');
    }
    if (!QUEST_TYPES.includes(type)) {
        return res.redirect('/admin/quests?error=유효하지 않은 규칙 유형입니다');
    }
    if (!/^[A-Z0-9_]{1,30}$/.test(category)) {
        return res.redirect('/admin/quests?error=규칙 카테고리는 영문 대문자/숫자/_ 조합으로 입력해주세요');
    }
    if (!Number.isFinite(count) || count < 1) {
        return res.redirect('/admin/quests?error=선발 개수는 1 이상의 정수여야 합니다');
    }
    if (!tierRange.ok) {
        return res.redirect(`/admin/quests?error=${encodeURIComponent(tierRange.error)}`);
    }

    const { error } = await supabase
        .from('quest_assignment_rule')
        .insert({
            scope,
            slot_no: slotNo,
            category,
            type,
            count,
            min_tier: tierRange.min_tier,
            max_tier: tierRange.max_tier,
            is_active: isChecked(req.body.is_active)
        });

    if (error) {
        console.error('Quest assignment rule create error:', error);
        if (error.code === '23505') {
            return res.redirect('/admin/quests?error=같은 범위/슬롯/티어구간 규칙이 이미 존재합니다');
        }
        if (error.code === '23503') {
            return res.redirect('/admin/quests?error=존재하지 않는 티어 값이 포함되어 있습니다');
        }
        return res.redirect('/admin/quests?error=퀘스트 슬롯 규칙 생성 중 오류가 발생했습니다');
    }

    res.redirect('/admin/quests?success=퀘스트 슬롯 규칙이 생성되었습니다');
});

const updateQuestAssignmentRule = asyncHandler(async (req, res) => {
    const { rule_id } = req.params;
    const scope = normalizeUpperToken(req.body.scope);
    const slotNo = parseIntOrDefault(req.body.slot_no, NaN);
    const category = normalizeUpperToken(req.body.category);
    const type = normalizeUpperToken(req.body.type);
    const count = parseIntOrDefault(req.body.count, NaN);
    const tierRange = parseTierRange(req.body.min_tier, req.body.max_tier);

    if (!QUEST_SCOPES.includes(scope)) {
        return res.redirect('/admin/quests?error=유효하지 않은 규칙 범위입니다');
    }
    if (!Number.isFinite(slotNo) || slotNo < 1) {
        return res.redirect('/admin/quests?error=슬롯 번호는 1 이상의 정수여야 합니다');
    }
    if (!QUEST_TYPES.includes(type)) {
        return res.redirect('/admin/quests?error=유효하지 않은 규칙 유형입니다');
    }
    if (!/^[A-Z0-9_]{1,30}$/.test(category)) {
        return res.redirect('/admin/quests?error=규칙 카테고리는 영문 대문자/숫자/_ 조합으로 입력해주세요');
    }
    if (!Number.isFinite(count) || count < 1) {
        return res.redirect('/admin/quests?error=선발 개수는 1 이상의 정수여야 합니다');
    }
    if (!tierRange.ok) {
        return res.redirect(`/admin/quests?error=${encodeURIComponent(tierRange.error)}`);
    }

    const { error } = await supabase
        .from('quest_assignment_rule')
        .update({
            scope,
            slot_no: slotNo,
            category,
            type,
            count,
            min_tier: tierRange.min_tier,
            max_tier: tierRange.max_tier,
            is_active: isChecked(req.body.is_active)
        })
        .eq('rule_id', rule_id);

    if (error) {
        console.error('Quest assignment rule update error:', error);
        if (error.code === '23505') {
            return res.redirect('/admin/quests?error=같은 범위/슬롯/티어구간 규칙이 이미 존재합니다');
        }
        if (error.code === '23503') {
            return res.redirect('/admin/quests?error=존재하지 않는 티어 값이 포함되어 있습니다');
        }
        return res.redirect('/admin/quests?error=퀘스트 슬롯 규칙 수정 중 오류가 발생했습니다');
    }

    res.redirect('/admin/quests?success=퀘스트 슬롯 규칙이 수정되었습니다');
});

const deleteQuestAssignmentRule = asyncHandler(async (req, res) => {
    const { rule_id } = req.params;

    const { error } = await supabase
        .from('quest_assignment_rule')
        .delete()
        .eq('rule_id', rule_id);

    if (error) {
        console.error('Quest assignment rule delete error:', error);
        return res.redirect('/admin/quests?error=퀘스트 슬롯 규칙 삭제 중 오류가 발생했습니다');
    }

    res.redirect('/admin/quests?success=퀘스트 슬롯 규칙이 삭제되었습니다');
});


// 티어 규칙 관리
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

const upsertTierRule = asyncHandler(async (req, res) => {
    const tier = parseIntOrDefault(req.body.tier, NaN);
    const minPoints = parseIntOrDefault(req.body.min_points, NaN);
    const name = String(req.body.name || '').trim();

    if (!Number.isFinite(tier) || tier < 1) {
        return res.redirect('/admin/tiers?error=티어 번호는 1 이상의 정수여야 합니다');
    }
    if (!Number.isFinite(minPoints) || minPoints < 0) {
        return res.redirect('/admin/tiers?error=최소 포인트는 0 이상의 정수여야 합니다');
    }
    if (!name) {
        return res.redirect('/admin/tiers?error=티어 이름은 필수입니다');
    }

    const { error } = await supabase
        .from('tier_rule')
        .upsert({
            tier,
            min_points: minPoints,
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
    getUsers,
    updateUserStatus,
    getQuestTemplates,
    createQuestTemplate,
    updateQuestTemplate,
    deleteQuestTemplate,
    createQuestAssignmentRule,
    updateQuestAssignmentRule,
    deleteQuestAssignmentRule,
    getTierRules,
    upsertTierRule
};
