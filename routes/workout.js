const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
    getRoutinesPage,
    getRoutineDetail,
    getNewRoutinePage,
    getEditRoutinePage,
    createRoutine,
    updateRoutine,
    deleteRoutine
} = require('../controllers/routine');
const {
    getFreeWorkoutPage,
    getFreeWorkoutSession,
    getRoutineWorkoutSession,
    startWorkoutSession,
    endWorkoutSession,
    abortWorkoutSession,
    recordWorkoutSet,
    recordSessionEvent,
    getPhaseDataset,
    savePhaseLabels,
    getWorkoutResult,
    getExercises
} = require('../controllers/workout');

const router = express.Router();

// ============ 루틴 라우트 ============

// 루틴 목록 페이지
router.get('/routine', requireAuth, getRoutinesPage);

// 새 루틴 만들기 페이지
router.get('/routine/new', requireAuth, getNewRoutinePage);

// 루틴 수정 페이지
router.get('/routine/:routineId/edit', requireAuth, getEditRoutinePage);

// 루틴 API
router.post('/api/routine', requireAuth, createRoutine);
router.get('/api/routine/:routineId', requireAuth, getRoutineDetail);
router.put('/api/routine/:routineId', requireAuth, updateRoutine);
router.delete('/api/routine/:routineId', requireAuth, deleteRoutine);

// ============ 운동 라우트 ============

// 자율 운동 목록
router.get('/workout/free', requireAuth, getFreeWorkoutPage);

// 자율 운동 세션
router.get('/workout/free/:exerciseCode', requireAuth, getFreeWorkoutSession);

// 루틴 운동 세션
router.get('/workout/routine/:routineId', requireAuth, getRoutineWorkoutSession);

// 운동 결과 페이지
router.get('/workout/result/:sessionId', requireAuth, getWorkoutResult);

// 운동 API
router.get('/api/exercises', getExercises);
router.post('/api/workout/session', requireAuth, startWorkoutSession);
router.put('/api/workout/session/:sessionId/end', requireAuth, endWorkoutSession);
router.post('/api/workout/session/:sessionId/abort', requireAuth, abortWorkoutSession);
router.post('/api/workout/session/:sessionId/set', requireAuth, recordWorkoutSet);
router.post('/api/workout/session/:sessionId/event', requireAuth, recordSessionEvent);
router.get('/api/workout/session/:sessionId/phase-dataset', requireAuth, getPhaseDataset);
router.post('/api/workout/session/:sessionId/phase-labels', requireAuth, savePhaseLabels);

module.exports = router;
