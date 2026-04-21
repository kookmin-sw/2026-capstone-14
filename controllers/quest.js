
const { supabase } = require('../config/db');

const QUEST_SOURCE_TYPE = 'QUEST';
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_QUEST_STATUSES = ['ACTIVE', 'DONE'];

const CONDITION_KIND = {
    WORKOUT_SESSION_COUNT: 'WORKOUT_SESSION_COUNT',
    ROUTINE_COMPLETE_COUNT: 'ROUTINE_COMPLETE_COUNT',
    SESSION_SCORE_COUNT: 'SESSION_SCORE_COUNT',
    TOTAL_SESSION_DURATION_SEC: 'TOTAL_SESSION_DURATION_SEC',
    ACTIVE_DAYS_COUNT: 'ACTIVE_DAYS_COUNT'
};

const QUEST_SELECT_FIELDS = `
    user_quest_id,
    status,
    progress,
    period_start,
    period_end,
    created_at,
    quest_template:quest_template_id (
        quest_template_id,
        scope,
        type,
        category,
        difficulty,
        title,
        condition,
        reward_points,
        selection_weight,
        cooldown_days,
        exclusive_group,
        min_tier,
        max_tier,
        is_active
    )
`;

const formatDateYmd = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

const parseDateYmd = (value) => {
    if (!value || typeof value !== 'string') {
        return null;
    }

    const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
    if (!year || !month || !day) {
        return null;
    }

    return new Date(year, month - 1, day, 0, 0, 0, 0);
};

const startOfDay = (date) => {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
};

const endOfDay = (date) => {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
};

const addDays = (date, days) => {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
};

const getWeekRange = () => {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const monday = startOfDay(addDays(now, -(dayOfWeek === 0 ? 6 : dayOfWeek - 1)));
    const sunday = endOfDay(addDays(monday, 6));
    return { start: monday, end: sunday };
};

const getTodayRange = () => {
    const now = new Date();
    return { start: startOfDay(now), end: endOfDay(now) };
};

const getScopePeriod = (scope) => {
    if (scope === 'WEEKLY') {
        const week = getWeekRange();
        return {
            startDate: week.start,
            endDate: week.end,
            startYmd: formatDateYmd(week.start),
            endYmd: formatDateYmd(week.end)
        };
    }

    const today = getTodayRange();
    return {
        startDate: today.start,
        endDate: today.end,
        startYmd: formatDateYmd(today.start),
        endYmd: formatDateYmd(today.end)
    };
};

const toNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const toNonNegativeNumber = (value, fallback = 0) => Math.max(0, toNumber(value, fallback));

const toPositiveInt = (value, fallback = 1) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const clampPercent = (value) => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round(value)));
};

const matchesTier = (row, tier) => {
    const minTier = row?.min_tier;
    const maxTier = row?.max_tier;
    if (minTier !== null && minTier !== undefined && tier < minTier) {
        return false;
    }
    if (maxTier !== null && maxTier !== undefined && tier > maxTier) {
        return false;
    }
    return true;
};

const getConditionTarget = (condition = {}, progress = {}) => {
    if (progress && Number.isFinite(Number(progress.target))) {
        return toPositiveInt(progress.target, 1);
    }

    if (condition.kind === CONDITION_KIND.SESSION_SCORE_COUNT) {
        return toPositiveInt(condition.occurrences ?? condition.value, 1);
    }

    return toPositiveInt(condition.value ?? condition.target, 1);
};

const evaluateOperator = (current, target, operator = 'GTE') => {
    switch (String(operator || 'GTE').toUpperCase()) {
        case 'GT':
            return current > target;
        case 'GTE':
            return current >= target;
        case 'LT':
            return current < target;
        case 'LTE':
            return current <= target;
        case 'EQ':
            return current === target;
        default:
            return current >= target;
    }
};

const getTypeLabel = (type) => {
    switch (type) {
        case 'DO':
            return '수행';
        case 'QUALITY':
            return '품질';
        case 'HABIT':
            return '습관';
        case 'CHALLENGE':
            return '도전';
        default:
            return '퀘스트';
    }
};

const getProgressDisplay = ({ kind, current, target, condition }) => {
    switch (kind) {
        case CONDITION_KIND.TOTAL_SESSION_DURATION_SEC: {
            const currentMin = Math.floor(toNonNegativeNumber(current) / 60);
            const targetMin = Math.ceil(toNonNegativeNumber(target) / 60);
            return {
                currentDisplay: currentMin,
                targetDisplay: targetMin,
                unitLabel: '분',
                hint: '누적 운동 시간'
            };
        }
        case CONDITION_KIND.ACTIVE_DAYS_COUNT:
            return {
                currentDisplay: Math.floor(toNonNegativeNumber(current)),
                targetDisplay: Math.floor(toNonNegativeNumber(target)),
                unitLabel: '일',
                hint: '운동한 날짜 수'
            };
        case CONDITION_KIND.SESSION_SCORE_COUNT: {
            const minScore = toPositiveInt(condition?.min_score, 0);
            return {
                currentDisplay: Math.floor(toNonNegativeNumber(current)),
                targetDisplay: Math.floor(toNonNegativeNumber(target)),
                unitLabel: '회',
                hint: minScore > 0 ? `${minScore}점 이상 세션` : '점수 조건 세션'
            };
        }
        case CONDITION_KIND.ROUTINE_COMPLETE_COUNT:
            return {
                currentDisplay: Math.floor(toNonNegativeNumber(current)),
                targetDisplay: Math.floor(toNonNegativeNumber(target)),
                unitLabel: '회',
                hint: '루틴 완료 횟수'
            };
        case CONDITION_KIND.WORKOUT_SESSION_COUNT:
        default:
            return {
                currentDisplay: Math.floor(toNonNegativeNumber(current)),
                targetDisplay: Math.floor(toNonNegativeNumber(target)),
                unitLabel: '회',
                hint: '운동 세션 완료 횟수'
            };
    }
};
const buildQuestProgressView = (quest) => {
    const condition = quest?.quest_template?.condition || {};
    const progress = quest?.progress || {};

    const kind = progress.kind || condition.kind || null;
    const operator = String(progress.operator || condition.operator || 'GTE').toUpperCase();
    const target = getConditionTarget(condition, progress);
    const current = toNonNegativeNumber(progress.current, 0);
    const completed = typeof progress.completed === 'boolean'
        ? progress.completed
        : evaluateOperator(current, target, operator);

    const display = getProgressDisplay({ kind, current, target, condition });
    const percentBase = target > 0 ? (current / target) * 100 : (completed ? 100 : 0);

    return {
        kind,
        operator,
        current,
        target,
        completed,
        canClaim: completed,
        percent: clampPercent(percentBase),
        currentDisplay: display.currentDisplay,
        targetDisplay: display.targetDisplay,
        unitLabel: display.unitLabel,
        hint: display.hint
    };
};

const buildQuestCardModel = (quest) => {
    const progressView = buildQuestProgressView(quest);

    return {
        questId: quest.user_quest_id,
        title: quest.quest_template?.title || '퀘스트',
        progress: progressView.currentDisplay,
        target: progressView.targetDisplay,
        progressType: quest.quest_template?.type || 'DO',
        progressUnit: progressView.unitLabel,
        status: quest.status,
        reward: quest.quest_template?.reward_points || 0,
        condition: quest.quest_template?.condition || {},
        canClaim: progressView.canClaim
    };
};

const getRequestUserId = (req, res) => req?.user?.user_id || res?.locals?.user?.user_id || null;

const getUserPointSummary = async (userId) => {
    const [pointResult, tierResult] = await Promise.all([
        supabase
            .from('point_ledger')
            .select('points')
            .eq('user_id', userId),
        supabase
            .from('tier_rule')
            .select('tier, min_points, name')
            .order('min_points', { ascending: false })
    ]);

    if (pointResult.error) {
        throw pointResult.error;
    }
    if (tierResult.error) {
        throw tierResult.error;
    }

    const totalPoints = (pointResult.data || []).reduce((sum, row) => sum + toNumber(row.points, 0), 0);
    const tierRules = tierResult.data || [];

    let currentTier = { tier: 1, min_points: 0, name: '브론즈' };
    let nextTier = null;

    for (let idx = 0; idx < tierRules.length; idx += 1) {
        const tierRule = tierRules[idx];
        if (totalPoints >= toNumber(tierRule.min_points, 0)) {
            currentTier = tierRule;
            nextTier = idx > 0 ? tierRules[idx - 1] : null;
            break;
        }
    }

    return {
        totalPoints,
        currentTier,
        nextTier,
        tier: toPositiveInt(currentTier.tier, 1)
    };
};

const buildTierProgress = (pointSummary = {}) => {
    const totalPoints = toNonNegativeNumber(pointSummary.totalPoints, 0);
    const currentTier = pointSummary.currentTier || { tier: 1, min_points: 0, name: '브론즈' };
    const nextTier = pointSummary.nextTier || null;

    const startPoints = toNonNegativeNumber(currentTier.min_points, 0);

    if (!nextTier) {
        return {
            currentTier,
            nextTier: null,
            startPoints,
            endPoints: startPoints,
            currentPoints: totalPoints,
            pointsInTier: Math.max(0, totalPoints - startPoints),
            pointsNeeded: 0,
            remainingPoints: 0,
            percent: 100,
            isMaxTier: true
        };
    }

    const endPoints = Math.max(startPoints, toNonNegativeNumber(nextTier.min_points, startPoints));
    const pointsNeeded = Math.max(1, endPoints - startPoints);
    const pointsInTier = Math.max(0, totalPoints - startPoints);

    return {
        currentTier,
        nextTier,
        startPoints,
        endPoints,
        currentPoints: totalPoints,
        pointsInTier,
        pointsNeeded,
        remainingPoints: Math.max(0, endPoints - totalPoints),
        percent: clampPercent((pointsInTier / pointsNeeded) * 100),
        isMaxTier: false
    };
};

const weightedPick = (templates) => {
    if (!Array.isArray(templates) || templates.length === 0) {
        return null;
    }

    const totalWeight = templates.reduce(
        (sum, row) => sum + Math.max(1, toPositiveInt(row.selection_weight, 1)),
        0
    );

    let random = Math.random() * totalWeight;

    for (const row of templates) {
        random -= Math.max(1, toPositiveInt(row.selection_weight, 1));
        if (random <= 0) {
            return row;
        }
    }

    return templates[templates.length - 1];
};

const getLatestAssignedDateByTemplate = (rows) => {
    const map = new Map();

    for (const row of rows || []) {
        const templateId = row.quest_template_id;
        const periodStart = row.period_start;
        if (!templateId || !periodStart) {
            continue;
        }

        const previous = map.get(templateId);
        if (!previous || periodStart > previous) {
            map.set(templateId, periodStart);
        }
    }

    return map;
};

const isTemplateCooldownReady = ({ template, latestDateByTemplate, periodStartDate }) => {
    const cooldownDays = toPositiveInt(template.cooldown_days, 0);
    if (cooldownDays <= 0) {
        return true;
    }

    const lastAssignedYmd = latestDateByTemplate.get(template.quest_template_id);
    if (!lastAssignedYmd) {
        return true;
    }

    const lastAssignedDate = parseDateYmd(lastAssignedYmd);
    if (!lastAssignedDate) {
        return true;
    }

    const diffDays = Math.floor((startOfDay(periodStartDate).getTime() - startOfDay(lastAssignedDate).getTime()) / DAY_MS);
    return diffDays > cooldownDays;
};

const pickRuleTemplate = ({
    baseCandidates,
    selectedTemplateIds,
    selectedExclusiveGroups,
    latestDateByTemplate,
    periodStartDate
}) => {
    const notSelected = baseCandidates.filter((template) => !selectedTemplateIds.has(template.quest_template_id));

    const withExclusive = notSelected.filter((template) => {
        const group = template.exclusive_group;
        return !group || !selectedExclusiveGroups.has(group);
    });

    const withCooldown = withExclusive.filter((template) => isTemplateCooldownReady({
        template,
        latestDateByTemplate,
        periodStartDate
    }));

    return weightedPick(withCooldown)
        || weightedPick(withExclusive)
        || weightedPick(notSelected)
        || null;
};

const selectTemplatesByRules = ({ rules, templateRows, latestDateByTemplate, periodStartDate }) => {
    const selected = [];
    const selectedTemplateIds = new Set();
    const selectedExclusiveGroups = new Set();

    for (const rule of rules) {
        const selectionCount = Math.max(1, toPositiveInt(rule.count, 1));

        for (let idx = 0; idx < selectionCount; idx += 1) {
            const candidates = templateRows.filter((template) => (
                template.type === rule.type && template.category === rule.category
            ));

            const picked = pickRuleTemplate({
                baseCandidates: candidates,
                selectedTemplateIds,
                selectedExclusiveGroups,
                latestDateByTemplate,
                periodStartDate
            });

            if (!picked) {
                break;
            }

            selected.push(picked);
            selectedTemplateIds.add(picked.quest_template_id);
            if (picked.exclusive_group) {
                selectedExclusiveGroups.add(picked.exclusive_group);
            }
        }
    }

    return selected;
};
const getCurrentScopeQuests = async ({ userId, scope, periodStartYmd, periodEndYmd }) => {
    const { data, error } = await supabase
        .from('user_quest')
        .select(`
            user_quest_id,
            status,
            progress,
            period_start,
            period_end,
            quest_template:quest_template_id (
                quest_template_id,
                scope,
                type,
                category,
                condition,
                reward_points,
                title
            )
        `)
        .eq('user_id', userId)
        .eq('period_start', periodStartYmd)
        .eq('period_end', periodEndYmd);

    if (error) {
        throw error;
    }

    return (data || []).filter((row) => row.quest_template?.scope === scope);
};

const assignScopeQuests = async ({ userId, scope, tier }) => {
    const period = getScopePeriod(scope);

    const existing = await getCurrentScopeQuests({
        userId,
        scope,
        periodStartYmd: period.startYmd,
        periodEndYmd: period.endYmd
    });

    if (existing.length > 0) {
        return false;
    }

    const [ruleResult, templateResult] = await Promise.all([
        supabase
            .from('quest_assignment_rule')
            .select('rule_id, scope, slot_no, category, type, count, min_tier, max_tier, is_active')
            .eq('scope', scope)
            .eq('is_active', true)
            .order('slot_no', { ascending: true })
            .order('rule_id', { ascending: true }),
        supabase
            .from('quest_template')
            .select('quest_template_id, scope, type, category, condition, reward_points, selection_weight, cooldown_days, exclusive_group, min_tier, max_tier, is_active')
            .eq('scope', scope)
            .eq('is_active', true)
    ]);

    if (ruleResult.error) {
        throw ruleResult.error;
    }
    if (templateResult.error) {
        throw templateResult.error;
    }

    const matchedRules = (ruleResult.data || []).filter((rule) => matchesTier(rule, tier));
    const matchedTemplates = (templateResult.data || []).filter((template) => matchesTier(template, tier));

    if (matchedRules.length === 0 || matchedTemplates.length === 0) {
        return false;
    }

    const maxCooldown = matchedTemplates.reduce(
        (max, template) => Math.max(max, toPositiveInt(template.cooldown_days, 0)),
        0
    );

    let latestDateByTemplate = new Map();

    if (maxCooldown > 0) {
        const cooldownStart = formatDateYmd(addDays(period.startDate, -maxCooldown));
        const { data: recentAssignments, error: recentError } = await supabase
            .from('user_quest')
            .select('quest_template_id, period_start')
            .eq('user_id', userId)
            .gte('period_start', cooldownStart)
            .lte('period_start', period.startYmd);

        if (recentError) {
            throw recentError;
        }

        latestDateByTemplate = getLatestAssignedDateByTemplate(recentAssignments);
    }

    const selectedTemplates = selectTemplatesByRules({
        rules: matchedRules,
        templateRows: matchedTemplates,
        latestDateByTemplate,
        periodStartDate: period.startDate
    });

    if (selectedTemplates.length === 0) {
        return false;
    }

    const insertRows = selectedTemplates.map((template) => ({
        user_id: userId,
        quest_template_id: template.quest_template_id,
        period_start: period.startYmd,
        period_end: period.endYmd,
        status: 'ACTIVE',
        progress: {
            kind: template.condition?.kind || null,
            operator: String(template.condition?.operator || 'GTE').toUpperCase(),
            current: 0,
            target: getConditionTarget(template.condition || {}, {}),
            completed: false
        }
    }));

    const { error: insertError } = await supabase
        .from('user_quest')
        .insert(insertRows);

    if (insertError && insertError.code !== '23505') {
        throw insertError;
    }

    return true;
};

const deriveSessionDurationSec = (session) => {
    const start = session?.started_at ? new Date(session.started_at) : null;
    const end = session?.ended_at ? new Date(session.ended_at) : null;

    if (start && end) {
        return Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
    }

    const resultUnit = String(session?.total_result_unit || '').toUpperCase();
    const resultBasis = String(session?.result_basis || '').toUpperCase();

    if (resultUnit === 'SEC' && resultBasis === 'DURATION') {
        return Math.max(0, toNumber(session?.total_result_value, 0));
    }

    return 0;
};

const rowMatchesStatus = (rowStatus, conditionStatus) => {
    if (!conditionStatus) {
        return true;
    }

    return String(rowStatus || '').toUpperCase() === String(conditionStatus).toUpperCase();
};

const toDateKey = (value) => {
    const date = new Date(value);
    return formatDateYmd(date);
};

const calculateCurrentValue = ({ condition, stats }) => {
    const kind = condition?.kind;
    const expectedStatus = condition?.status || 'DONE';

    const sessions = stats.sessions || [];
    const routines = stats.routines || [];

    switch (kind) {
        case CONDITION_KIND.WORKOUT_SESSION_COUNT:
            return sessions.filter((row) => rowMatchesStatus(row.status, expectedStatus)).length;

        case CONDITION_KIND.ROUTINE_COMPLETE_COUNT:
            return routines.filter((row) => rowMatchesStatus(row.status, expectedStatus)).length;

        case CONDITION_KIND.SESSION_SCORE_COUNT: {
            const minScore = toNumber(condition?.min_score, 0);
            return sessions.filter((row) => (
                rowMatchesStatus(row.status, expectedStatus)
                && toNumber(row.final_score, 0) >= minScore
            )).length;
        }

        case CONDITION_KIND.TOTAL_SESSION_DURATION_SEC:
            return sessions
                .filter((row) => rowMatchesStatus(row.status, expectedStatus))
                .reduce((sum, row) => sum + deriveSessionDurationSec(row), 0);

        case CONDITION_KIND.ACTIVE_DAYS_COUNT: {
            const dayKeys = new Set(
                sessions
                    .filter((row) => rowMatchesStatus(row.status, expectedStatus))
                    .map((row) => toDateKey(row.started_at))
            );
            return dayKeys.size;
        }

        default:
            return 0;
    }
};

const buildProgressPayload = ({ condition, stats }) => {
    const operator = String(condition?.operator || 'GTE').toUpperCase();
    const target = getConditionTarget(condition || {}, {});
    const current = toNonNegativeNumber(calculateCurrentValue({ condition, stats }), 0);

    return {
        kind: condition?.kind || null,
        operator,
        current,
        target,
        completed: evaluateOperator(current, target, operator),
        status: condition?.status || 'DONE',
        min_score: toNumber(condition?.min_score, 0),
        occurrences: toNumber(condition?.occurrences, 0),
        updated_at: new Date().toISOString()
    };
};
const fetchPeriodStats = async ({ userId, periodStartYmd, periodEndYmd }) => {
    const startDate = parseDateYmd(periodStartYmd);
    const endDate = parseDateYmd(periodEndYmd);

    if (!startDate || !endDate) {
        return { sessions: [], routines: [] };
    }

    const periodStartIso = startOfDay(startDate).toISOString();
    const periodEndIso = endOfDay(endDate).toISOString();

    const [sessionResult, routineResult] = await Promise.all([
        supabase
            .from('workout_session')
            .select('session_id, status, started_at, ended_at, final_score, result_basis, total_result_value, total_result_unit')
            .eq('user_id', userId)
            .gte('started_at', periodStartIso)
            .lte('started_at', periodEndIso),
        supabase
            .from('routine_instance')
            .select('routine_instance_id, status, started_at, ended_at')
            .eq('user_id', userId)
            .gte('started_at', periodStartIso)
            .lte('started_at', periodEndIso)
    ]);

    if (sessionResult.error) {
        throw sessionResult.error;
    }
    if (routineResult.error) {
        throw routineResult.error;
    }

    return {
        sessions: sessionResult.data || [],
        routines: routineResult.data || []
    };
};

const progressHasChanged = (existingProgress, nextProgress) => {
    const before = JSON.stringify(existingProgress || {});
    const after = JSON.stringify(nextProgress || {});
    return before !== after;
};

const refreshQuestProgressForRows = async (userId, questRows) => {
    const rows = Array.isArray(questRows) ? questRows : [];
    if (rows.length === 0) {
        return new Map();
    }

    const groupedByPeriod = new Map();

    for (const quest of rows) {
        const periodKey = `${quest.period_start}|${quest.period_end}`;
        if (!groupedByPeriod.has(periodKey)) {
            groupedByPeriod.set(periodKey, {
                periodStartYmd: quest.period_start,
                periodEndYmd: quest.period_end,
                quests: []
            });
        }
        groupedByPeriod.get(periodKey).quests.push(quest);
    }

    const resultMap = new Map();

    for (const group of groupedByPeriod.values()) {
        const stats = await fetchPeriodStats({
            userId,
            periodStartYmd: group.periodStartYmd,
            periodEndYmd: group.periodEndYmd
        });

        for (const quest of group.quests) {
            const condition = quest.quest_template?.condition || {};
            const nextProgress = buildProgressPayload({ condition, stats });

            resultMap.set(quest.user_quest_id, nextProgress);

            if (progressHasChanged(quest.progress, nextProgress)) {
                const { error: updateError } = await supabase
                    .from('user_quest')
                    .update({
                        progress: nextProgress,
                        updated_at: new Date().toISOString()
                    })
                    .eq('user_quest_id', quest.user_quest_id)
                    .eq('user_id', userId)
                    .eq('status', 'ACTIVE');

                if (updateError) {
                    throw updateError;
                }
            }
        }
    }

    return resultMap;
};

const refreshAllActiveQuestProgress = async (userId) => {
    if (!userId) {
        return;
    }

    const { data: activeQuests, error } = await supabase
        .from('user_quest')
        .select(QUEST_SELECT_FIELDS)
        .eq('user_id', userId)
        .eq('status', 'ACTIVE');

    if (error) {
        throw error;
    }

    await refreshQuestProgressForRows(userId, activeQuests || []);
};

const hydrateQuestsForView = (rows, progressMap) => {
    return (rows || []).map((quest) => {
        const mergedProgress = progressMap.has(quest.user_quest_id)
            ? progressMap.get(quest.user_quest_id)
            : (quest.progress || {});

        const hydratedQuest = {
            ...quest,
            progress: mergedProgress
        };

        return {
            ...hydratedQuest,
            type_label: getTypeLabel(hydratedQuest.quest_template?.type),
            progress_view: buildQuestProgressView(hydratedQuest)
        };
    });
};

const loadCurrentQuests = async (userId) => {
    const today = getTodayRange();
    const week = getWeekRange();

    const todayYmd = formatDateYmd(today.start);
    const weekStartYmd = formatDateYmd(week.start);
    const weekEndYmd = formatDateYmd(week.end);

    const { data, error } = await supabase
        .from('user_quest')
        .select(QUEST_SELECT_FIELDS)
        .eq('user_id', userId)
        .in('status', ACTIVE_QUEST_STATUSES)
        .lte('period_start', weekEndYmd)
        .gte('period_end', todayYmd)
        .order('created_at', { ascending: false });

    if (error) {
        throw error;
    }

    const rows = data || [];

    const dailyQuests = rows.filter((quest) => (
        quest.quest_template?.scope === 'DAILY'
        && quest.period_start <= todayYmd
        && quest.period_end >= todayYmd
    ));

    const weeklyQuests = rows.filter((quest) => (
        quest.quest_template?.scope === 'WEEKLY'
        && quest.period_start <= weekEndYmd
        && quest.period_end >= weekStartYmd
    ));

    return {
        today,
        week,
        todayYmd,
        weekStartYmd,
        weekEndYmd,
        rows,
        dailyQuests,
        weeklyQuests
    };
};
const assignDailyQuests = async (req, res, next) => {
    try {
        const userId = getRequestUserId(req, res);
        if (!userId) {
            return next();
        }

        const pointSummary = await getUserPointSummary(userId);
        const inserted = await assignScopeQuests({
            userId,
            scope: 'DAILY',
            tier: pointSummary.tier
        });

        if (inserted) {
            await refreshAllActiveQuestProgress(userId);
        }

        return next();
    } catch (error) {
        console.error('Daily quest assignment error:', error);
        return next();
    }
};

const assignWeeklyQuests = async (req, res, next) => {
    try {
        const userId = getRequestUserId(req, res);
        if (!userId) {
            return next();
        }

        const pointSummary = await getUserPointSummary(userId);
        const inserted = await assignScopeQuests({
            userId,
            scope: 'WEEKLY',
            tier: pointSummary.tier
        });

        if (inserted) {
            await refreshAllActiveQuestProgress(userId);
        }

        return next();
    } catch (error) {
        console.error('Weekly quest assignment error:', error);
        return next();
    }
};

const getQuestPage = async (req, res, next) => {
    try {
        const userId = req.user.user_id;

        const [{ dailyQuests, weeklyQuests }, pointSummary, pointHistoryResult] = await Promise.all([
            loadCurrentQuests(userId),
            getUserPointSummary(userId),
            supabase
                .from('point_ledger')
                .select('ledger_id, source_type, source_id, points, note, created_at')
                .eq('user_id', userId)
                .order('created_at', { ascending: false })
                .limit(5)
        ]);

        if (pointHistoryResult.error) {
            throw pointHistoryResult.error;
        }

        const activeRows = [...dailyQuests, ...weeklyQuests].filter((row) => row.status === 'ACTIVE');
        const progressMap = await refreshQuestProgressForRows(userId, activeRows);

        const dailyView = hydrateQuestsForView(dailyQuests, progressMap);
        const weeklyView = hydrateQuestsForView(weeklyQuests, progressMap);

        const today = getTodayRange();
        const week = getWeekRange();

        const [todaySessionsResult, weekSessionsResult] = await Promise.all([
            supabase
                .from('workout_session')
                .select('session_id', { count: 'exact', head: true })
                .eq('user_id', userId)
                .eq('status', 'DONE')
                .gte('started_at', today.start.toISOString())
                .lte('started_at', today.end.toISOString()),
            supabase
                .from('workout_session')
                .select('started_at, status')
                .eq('user_id', userId)
                .eq('status', 'DONE')
                .gte('started_at', week.start.toISOString())
                .lte('started_at', week.end.toISOString())
        ]);

        if (todaySessionsResult.error) {
            throw todaySessionsResult.error;
        }
        if (weekSessionsResult.error) {
            throw weekSessionsResult.error;
        }

        const uniqueWeekDays = new Set((weekSessionsResult.data || []).map((row) => toDateKey(row.started_at))).size;

        return res.render('quest/index', {
            title: '퀘스트',
            activeTab: 'quest',
            dailyQuests: dailyView,
            weeklyQuests: weeklyView,
            totalPoints: pointSummary.totalPoints,
            currentTier: pointSummary.currentTier,
            nextTier: pointSummary.nextTier,
            tierProgress: buildTierProgress(pointSummary),
            pointHistory: pointHistoryResult.data || [],
            stats: {
                todaySessions: todaySessionsResult.count || 0,
                weeklyDays: uniqueWeekDays
            }
        });
    } catch (error) {
        return next(error);
    }
};

const claimQuestReward = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const questId = Number.parseInt(req.params.questId, 10);

        if (!Number.isInteger(questId) || questId <= 0) {
            return res.status(400).json({ error: '유효하지 않은 퀘스트 ID입니다.' });
        }

        const { data: userQuest, error: questError } = await supabase
            .from('user_quest')
            .select(QUEST_SELECT_FIELDS)
            .eq('user_quest_id', questId)
            .eq('user_id', userId)
            .single();

        if (questError || !userQuest) {
            return res.status(404).json({ error: '퀘스트를 찾을 수 없습니다.' });
        }

        if (userQuest.status === 'DONE') {
            return res.status(400).json({ error: '이미 완료한 퀘스트입니다.' });
        }

        const todayYmd = formatDateYmd(new Date());
        if (userQuest.period_end && userQuest.period_end < todayYmd) {
            await supabase
                .from('user_quest')
                .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
                .eq('user_quest_id', questId)
                .eq('user_id', userId)
                .eq('status', 'ACTIVE');

            return res.status(400).json({ error: '이미 기간이 지난 퀘스트입니다.' });
        }

        const progressMap = await refreshQuestProgressForRows(userId, [userQuest]);
        const refreshedProgress = progressMap.get(userQuest.user_quest_id) || userQuest.progress || {};
        const target = toPositiveInt(refreshedProgress.target, 1);
        const current = toNonNegativeNumber(refreshedProgress.current, 0);
        const canClaim = Boolean(refreshedProgress.completed);

        if (!canClaim) {
            return res.status(400).json({
                error: '퀘스트 조건을 아직 달성하지 못했습니다.',
                current,
                target
            });
        }

        const { error: statusUpdateError } = await supabase
            .from('user_quest')
            .update({
                status: 'DONE',
                updated_at: new Date().toISOString()
            })
            .eq('user_quest_id', questId)
            .eq('user_id', userId)
            .eq('status', 'ACTIVE');

        if (statusUpdateError) {
            throw statusUpdateError;
        }

        const rewardPoints = toNonNegativeNumber(userQuest.quest_template?.reward_points, 0);
        let awardedPoints = 0;

        if (rewardPoints > 0) {
            const { error: pointError } = await supabase
                .from('point_ledger')
                .insert({
                    user_id: userId,
                    source_type: QUEST_SOURCE_TYPE,
                    source_id: questId,
                    points: rewardPoints,
                    note: `퀘스트 완료: ${userQuest.quest_template?.title || '퀘스트'}`
                });

            if (pointError && pointError.code !== '23505') {
                throw pointError;
            }

            if (!pointError) {
                awardedPoints = rewardPoints;
            }
        }

        return res.json({
            success: true,
            points: awardedPoints,
            message: awardedPoints > 0
                ? `${awardedPoints} 포인트를 획득했습니다!`
                : '퀘스트가 완료 처리되었습니다.'
        });
    } catch (error) {
        return next(error);
    }
};

const completeQuest = claimQuestReward;

const updateQuestProgress = async (userId) => {
    try {
        await refreshAllActiveQuestProgress(userId);
    } catch (error) {
        console.error('Quest progress update error:', error);
    }
};

module.exports = {
    getQuestPage,
    completeQuest,
    assignDailyQuests,
    assignWeeklyQuests,
    updateQuestProgress,
    claimQuestReward,
    refreshAllActiveQuestProgress,
    refreshQuestProgressForRows,
    buildQuestProgressView,
    buildQuestCardModel,
    getWeekRange,
    getTodayRange
};
