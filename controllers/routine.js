const { supabase } = require('../config/db');

// 루틴 목록 페이지
const getRoutinesPage = async (req, res, next) => {
    try {
        const userId = req.user.user_id;

        // 사용자의 루틴 목록 조회
        const { data: routines, error } = await supabase
            .from('routine')
            .select(`
                routine_id,
                name,
                is_active,
                created_at,
                updated_at,
                routine_setup (
                    step_id,
                    order_no,
                    target_type,
                    target_value,
                    rest_sec,
                    sets,
                    exercise:exercise_id (
                        exercise_id,
                        code,
                        name
                    )
                )
            `)
            .eq('user_id', userId)
            .eq('is_active', true)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // 운동 목록 조회 (루틴 추가용)
        const { data: exercises, error: exError } = await supabase
            .from('exercise')
            .select('exercise_id, code, name, description')
            .eq('is_active', true)
            .order('name');

        if (exError) throw exError;

        res.render('routine/index', {
            title: '나의 루틴',
            activeTab: 'routine',
            routines: routines || [],
            exercises: exercises || []
        });
    } catch (error) {
        next(error);
    }
};

// 루틴 상세 조회 API
const getRoutineDetail = async (req, res, next) => {
    try {
        const { routineId } = req.params;
        const userId = req.user.user_id;

        const { data: routine, error } = await supabase
            .from('routine')
            .select(`
                routine_id,
                name,
                is_active,
                created_at,
                updated_at,
                routine_setup (
                    step_id,
                    order_no,
                    target_type,
                    target_value,
                    rest_sec,
                    sets,
                    exercise:exercise_id (
                        exercise_id,
                        code,
                        name
                    )
                )
            `)
            .eq('routine_id', routineId)
            .eq('user_id', userId)
            .single();

        if (error || !routine) {
            return res.status(404).json({ error: '루틴을 찾을 수 없습니다.' });
        }

        // order_no 기준으로 정렬
        routine.routine_setup.sort((a, b) => a.order_no - b.order_no);

        res.json(routine);
    } catch (error) {
        next(error);
    }
};

// 새 루틴 생성 페이지
const getNewRoutinePage = async (req, res, next) => {
    try {
        // 운동 목록 조회
        const { data: exercises, error } = await supabase
            .from('exercise')
            .select('exercise_id, code, name, description')
            .eq('is_active', true)
            .order('name');

        if (error) throw error;

        res.render('routine/edit', {
            title: '새 루틴 만들기',
            activeTab: 'routine',
            routine: null,
            exercises: exercises || [],
            isNew: true
        });
    } catch (error) {
        next(error);
    }
};

// 루틴 수정 페이지
const getEditRoutinePage = async (req, res, next) => {
    try {
        const { routineId } = req.params;
        const userId = req.user.user_id;

        // 루틴 조회
        const { data: routine, error } = await supabase
            .from('routine')
            .select(`
                routine_id,
                name,
                routine_setup (
                    step_id,
                    order_no,
                    target_type,
                    target_value,
                    rest_sec,
                    sets,
                    exercise:exercise_id (
                        exercise_id,
                        code,
                        name
                    )
                )
            `)
            .eq('routine_id', routineId)
            .eq('user_id', userId)
            .single();

        if (error || !routine) {
            return res.redirect('/routine?error=루틴을 찾을 수 없습니다');
        }

        // order_no 기준으로 정렬
        routine.routine_setup.sort((a, b) => a.order_no - b.order_no);

        // 운동 목록 조회
        const { data: exercises, error: exError } = await supabase
            .from('exercise')
            .select('exercise_id, code, name, description')
            .eq('is_active', true)
            .order('name');

        if (exError) throw exError;

        res.render('routine/edit', {
            title: '루틴 수정',
            activeTab: 'routine',
            routine,
            exercises: exercises || [],
            isNew: false
        });
    } catch (error) {
        next(error);
    }
};

// 루틴 생성 API
const createRoutine = async (req, res, next) => {
    try {
        const userId = req.user.user_id;
        const { name, steps } = req.body;

        if (!name || !steps || steps.length === 0) {
            return res.status(400).json({ error: '루틴 이름과 운동 단계가 필요합니다.' });
        }

        // 루틴 생성
        const { data: routine, error: routineError } = await supabase
            .from('routine')
            .insert({
                user_id: userId,
                name: name.trim()
            })
            .select()
            .single();

        if (routineError) throw routineError;

        // 루틴 스텝 생성
        const setupData = steps.map((step, index) => ({
            routine_id: routine.routine_id,
            order_no: index + 1,
            exercise_id: step.exercise_id,
            target_type: step.target_type || 'REPS',
            target_value: parseInt(step.target_value) || 10,
            rest_sec: parseInt(step.rest_sec) || 30,
            sets: parseInt(step.sets) || 3
        }));

        const { error: setupError } = await supabase
            .from('routine_setup')
            .insert(setupData);

        if (setupError) throw setupError;

        res.json({ success: true, routine_id: routine.routine_id });
    } catch (error) {
        next(error);
    }
};

// 루틴 수정 API
const updateRoutine = async (req, res, next) => {
    try {
        const { routineId } = req.params;
        const userId = req.user.user_id;
        const { name, steps } = req.body;

        // 루틴 소유자 확인
        const { data: existing, error: checkError } = await supabase
            .from('routine')
            .select('routine_id')
            .eq('routine_id', routineId)
            .eq('user_id', userId)
            .single();

        if (checkError || !existing) {
            return res.status(404).json({ error: '루틴을 찾을 수 없습니다.' });
        }

        // 루틴 이름 업데이트
        const { error: updateError } = await supabase
            .from('routine')
            .update({ name: name.trim(), updated_at: new Date().toISOString() })
            .eq('routine_id', routineId);

        if (updateError) throw updateError;

        // 기존 스텝 삭제
        const { error: deleteError } = await supabase
            .from('routine_setup')
            .delete()
            .eq('routine_id', routineId);

        if (deleteError) throw deleteError;

        // 새 스텝 생성
        if (steps && steps.length > 0) {
            const setupData = steps.map((step, index) => ({
                routine_id: routineId,
                order_no: index + 1,
                exercise_id: step.exercise_id,
                target_type: step.target_type || 'REPS',
                target_value: parseInt(step.target_value) || 10,
                rest_sec: parseInt(step.rest_sec) || 30,
                sets: parseInt(step.sets) || 3
            }));

            const { error: setupError } = await supabase
                .from('routine_setup')
                .insert(setupData);

            if (setupError) throw setupError;
        }

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

// 루틴 삭제 API (soft delete)
const deleteRoutine = async (req, res, next) => {
    try {
        const { routineId } = req.params;
        const userId = req.user.user_id;

        const { error } = await supabase
            .from('routine')
            .update({ is_active: false })
            .eq('routine_id', routineId)
            .eq('user_id', userId);

        if (error) throw error;

        res.json({ success: true });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getRoutinesPage,
    getRoutineDetail,
    getNewRoutinePage,
    getEditRoutinePage,
    createRoutine,
    updateRoutine,
    deleteRoutine
};
