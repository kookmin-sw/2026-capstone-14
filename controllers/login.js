const asyncHandler = require('express-async-handler');
const argon2 = require('argon2');
const { supabase } = require('../config/db');
const { generateToken } = require('../middleware/auth');

// @desc 로그인 페이지
// @route GET /login
const getLoginPage = asyncHandler(async (req, res) => {
    const { error, message, returnTo } = req.query;
    res.render('login', { 
        title: '로그인', 
        activeTab: 'login',
        error,
        message,
        returnTo: returnTo || ''
    });
});

// @desc 로그인 처리
// @route POST /login
const handleLogin = asyncHandler(async (req, res) => {
    const { login_id, password } = req.body;
    const errorMessage = '아이디 또는 비밀번호가 일치하지 않습니다.';

    // 입력값 기본 검증
    if (!login_id || !password) {
        return res.status(401).render('login', {
            title: '로그인',
            activeTab: 'login',
            error: errorMessage,
            formData: { login_id }
        });
    }

    // DB에서 사용자 조회
    const { data: user, error } = await supabase
        .from('app_user')
        .select('user_id, login_id, password_hash, nickname, status')
        .eq('login_id', login_id)
        .single();

    // 사용자가 없거나 DB 오류
    if (error || !user) {
        return res.status(401).render('login', {
            title: '로그인',
            activeTab: 'login',
            error: errorMessage,
            formData: { login_id }
        });
    }

    // 계정 상태 확인 (blocked, deleted)
    if (user.status !== 'active') {
        return res.status(401).render('login', {
            title: '로그인',
            activeTab: 'login',
            error: errorMessage,
            formData: { login_id }
        });
    }

    // 비밀번호 검증
    let isValidPassword = false;
    try {
        isValidPassword = await argon2.verify(user.password_hash, password);
    } catch (err) {
        console.error('Password verification error:', err);
        return res.status(401).render('login', {
            title: '로그인',
            activeTab: 'login',
            error: errorMessage,
            formData: { login_id }
        });
    }

    // 해싱 방식 문젠가
    if (!isValidPassword) {
        return res.status(401).render('login', {
            title: '로그인',
            activeTab: 'login',
            error: errorMessage,
            formData: { login_id }
        });
    }

    // 마지막 로그인 시간 업데이트
    await supabase
        .from('app_user')
        .update({ last_login_at: new Date().toISOString() })
        .eq('user_id', user.user_id);

    // JWT 토큰 생성
    const token = generateToken({
        user_id: user.user_id,
        login_id: user.login_id,
        nickname: user.nickname
    });

    // 쿠키에 토큰 저장 (httpOnly로 XSS 방지)
    res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7일
    });

    // admin 계정은 관리자 페이지로 리다이렉트
    if (user.login_id === 'admin') {
        return res.redirect('/admin');
    }

    // returnTo가 있으면 해당 페이지로, 없으면 홈으로 리다이렉트
    const returnTo = req.body.returnTo;
    // 보안: 외부 URL로 리다이렉트 방지 (상대 경로만 허용)
    const safeRedirect = returnTo && returnTo.startsWith('/') && !returnTo.startsWith('//') 
        ? returnTo 
        : '/';
    res.redirect(safeRedirect);
});

module.exports = {
    getLoginPage,
    handleLogin,
};