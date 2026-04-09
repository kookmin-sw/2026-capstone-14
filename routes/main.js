const express = require('express');
const { getSignupPage, handleSignup, checkLoginId } = require('../controllers/signup');
const { getLoginPage, handleLogin } = require('../controllers/login');
const { requireGuest, requireAuth, handleLogout } = require('../middleware/auth');
const { getQuestPage, completeQuest, claimQuestReward, assignDailyQuests, assignWeeklyQuests } = require('../controllers/quest');
const { getHistoryPage, getSessionDetail, getHistoryStats, deleteSession } = require('../controllers/history');
const { getHomePage } = require('../controllers/home');
const { getSettingsPage, updateNickname, updatePassword, updateTheme, getUserSettings } = require('../controllers/settings');
const router = express.Router();

// admin 계정은 일반 페이지로 들어가지 않게 막기
const blockAdmin = (req, res, next) => {
    if (res.locals.isAuthenticated && res.locals.user?.login_id === 'admin') {
        return res.redirect('/admin');
    }
    next();
};

// 로그인한 사용자에게만 퀘스트 할당 미들웨어 실행
const conditionalQuestAssign = (middleware) => (req, res, next) => {
    if (res.locals.isAuthenticated && res.locals.user) {
        return middleware(req, res, next);
    }
    next();
};

router.route('/')
    .get(blockAdmin, conditionalQuestAssign(assignDailyQuests), conditionalQuestAssign(assignWeeklyQuests), getHomePage);

// 로그인 (로그인한 사용자는 접근 불가)
router.route('/login')
    .get(requireGuest, getLoginPage)
    .post(requireGuest, handleLogin);

// 회원가입 (로그인한 사용자는 접근 불가)
router.route('/signup')
    .get(requireGuest, getSignupPage)
    .post(requireGuest, handleSignup);
router.post('/signup/check-id', checkLoginId);

// 로그아웃
router.get('/logout', handleLogout);

// 퀘스트 페이지 (로그인 필요)
router.get('/quest', requireAuth, assignDailyQuests, assignWeeklyQuests, getQuestPage);

// 퀘스트 API
router.post('/api/quest/:questId/complete', requireAuth, completeQuest);
router.post('/api/quest/:questId/claim', requireAuth, claimQuestReward);

// 운동 히스토리 (로그인 필요)
router.get('/history', requireAuth, getHistoryPage);

// 히스토리 API
router.get('/api/history/stats', requireAuth, getHistoryStats);
router.get('/api/history/:sessionId', requireAuth, getSessionDetail);
router.delete('/api/history/:sessionId', requireAuth, deleteSession);

// 설정 페이지 (로그인 필요)
router.get('/settings', requireAuth, getSettingsPage);

// 설정 API
router.post('/settings/nickname', requireAuth, updateNickname);
router.post('/settings/password', requireAuth, updatePassword);
router.post('/settings/theme', requireAuth, updateTheme);
router.get('/api/settings', getUserSettings);

module.exports = router;