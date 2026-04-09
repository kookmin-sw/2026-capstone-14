const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const {
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
} = require('../controllers/admin');

// 모든 관리자 라우트에 requireAdmin 미들웨어 적용
router.use(requireAdmin);

// 대시보드
router.get('/', getDashboard);

// 운동 관리
router.get('/exercises', getExercises);
router.post('/exercises', createExercise);
router.post('/exercises/:exercise_id', updateExercise);
router.post('/exercises/:exercise_id/delete', deleteExercise);

// 채점 지표 관리
router.get('/metrics', getMetrics);
router.post('/metrics', createMetric);
router.post('/metrics/:metric_id', updateMetric);
router.post('/metrics/:metric_id/delete', deleteMetric);

// 채점 프로파일 관리
router.get('/scoring', getScoringProfiles);
router.post('/scoring', createScoringProfile);
router.get('/scoring/:profile_id', getScoringProfileDetail);
router.post('/scoring/:profile_id', updateScoringProfile);
router.post('/scoring/:profile_id/delete', deleteScoringProfile);

// 프로파일 지표 관리
router.post('/scoring/:profile_id/metrics', addProfileMetric);
router.post('/scoring/:profile_id/metrics/:metric_id/delete', removeProfileMetric);

// 사용자 관리
router.get('/users', getUsers);
router.post('/users/:user_id/status', updateUserStatus);

// 퀘스트 템플릿 관리
router.get('/quests', getQuestTemplates);
router.post('/quests', createQuestTemplate);
router.post('/quests/:quest_template_id', updateQuestTemplate);
router.post('/quests/:quest_template_id/delete', deleteQuestTemplate);

// 티어 관리
router.get('/tiers', getTierRules);
router.post('/tiers', upsertTierRule);

module.exports = router;
