const asyncHandler = require('express-async-handler');
const argon2 = require('argon2');
const { supabase } = require('../config/db');

// @desc 회원가입 페이지
// @route GET /signup
const getSignupPage = asyncHandler(async (req, res) => {
    res.render('signup', { title: '회원가입', activeTab: 'signup' });
});

// @desc 로그인 ID 중복 체크
// @route POST /signup/check-id
const checkLoginId = asyncHandler(async (req, res) => {
    const { login_id } = req.body;

    if (!login_id || login_id.length < 4) {
        return res.status(400).json({ 
            valid: false, 
            message: '아이디는 4자 이상이어야 합니다.' 
        });
    }

    if (login_id.length > 64) {
        return res.status(400).json({ 
            valid: false, 
            message: '아이디는 64자 이하여야 합니다.' 
        });
    }

    // 영문, 숫자, 밑줄만 허용
    if (!/^[a-zA-Z0-9_]+$/.test(login_id)) {
        return res.status(400).json({ 
            valid: false, 
            message: '아이디는 영문, 숫자, 밑줄(_)만 사용 가능합니다.' 
        });
    }

    const { data, error } = await supabase
        .from('app_user')
        .select('user_id')
        .eq('login_id', login_id)
        .single();

    if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows found (정상적인 경우)
        console.error('DB Error:', error);
        return res.status(500).json({ 
            valid: false, 
            message: '서버 오류가 발생했습니다. 나중에 다시 시도해주세요' 
        });
    }

    if (data) {
        return res.json({ 
            valid: false, 
            message: '이미 사용 중인 아이디입니다.' 
        });
    }

    return res.json({ 
        valid: true, 
        message: '사용 가능한 아이디입니다.' 
    });
});

// @desc Handle Signup Form Submission
// @route POST /signup
const handleSignup = asyncHandler(async (req, res) => {
    const { login_id, nickname, password, confirmPassword } = req.body;
    const errors = {};

    // 아이디 검증
    if (!login_id || login_id.length < 4) {
        errors.login_id = '아이디는 4자 이상이어야 합니다.';
    } else if (login_id.length > 64) {
        errors.login_id = '아이디는 64자 이하여야 합니다.';
    } else if (!/^[a-zA-Z0-9_]+$/.test(login_id)) {
        errors.login_id = '아이디는 영문, 숫자, 밑줄(_)만 사용 가능합니다.';
    }

    // 닉네임 검증
    if (!nickname || nickname.length < 2) {
        errors.nickname = '닉네임은 2자 이상이어야 합니다.';
    } else if (nickname.length > 32) {
        errors.nickname = '닉네임은 32자 이하여야 합니다.';
    }

    // 비밀번호 검증
    if (!password || password.length < 8) {
        errors.password = '비밀번호는 8자 이상이어야 합니다.';
    }

    // 비밀번호 확인 검증
    if (password !== confirmPassword) {
        errors.confirmPassword = '비밀번호가 일치하지 않습니다.';
    }

    // 아이디 중복 체크
    if (!errors.login_id) {
        const { data: existingUser } = await supabase
            .from('app_user')
            .select('user_id')
            .eq('login_id', login_id)
            .single();

        if (existingUser) {
            errors.login_id = '이미 사용 중인 아이디입니다.';
        }
    }

    // 에러가 있으면 폼에 에러 표시
    if (Object.keys(errors).length > 0) {
        return res.render('signup', {
            title: '회원가입',
            activeTab: 'signup',
            errors,
            formData: { login_id, nickname }
        });
    }

    // 비밀번호 해싱 (argon2id)
    const password_hash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 4
    });

    // DB에 사용자 저장
    const { data, error } = await supabase
        .from('app_user')
        .insert({
            login_id,
            password_hash,
            nickname
        })
        .select()
        .single();

    if (error) {
        console.error('Signup Error:', error);
        return res.render('signup', {
            title: '회원가입',
            activeTab: 'signup',
            errors: { general: '회원가입 중 오류가 발생했습니다.' },
            formData: { login_id, nickname }
        });
    }

    // 성공 시 로그인 페이지로 리다이렉트
    res.redirect('/login?signup=success');
});

module.exports = {
    getSignupPage,
    handleSignup,
    checkLoginId
};