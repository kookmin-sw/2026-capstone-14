require('dotenv').config();
const jwt = require('jsonwebtoken');
const { supabase } = require('../config/db');

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// JWT 토큰 생성
const generateToken = (user) => {
    return jwt.sign(
        {
            user_id: user.user_id,
            login_id: user.login_id,
            nickname: user.nickname
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
    );
};

// UI 표시용 인증 상태 설정 (보안 검증용 아님)
const addAuthState = async (req, res, next) => {
    const token = req.cookies.token;
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            res.locals.isAuthenticated = true;
            res.locals.user = {
                user_id: decoded.user_id,
                login_id: decoded.login_id,
                nickname: decoded.nickname
            };
            
            // 사용자 테마 설정 가져오기
            const { data: settings } = await supabase
                .from('user_settings')
                .select('theme')
                .eq('user_id', decoded.user_id)
                .single();
            
            res.locals.userTheme = settings?.theme || 'system';
        } catch (error) {
            res.locals.isAuthenticated = false;
            res.locals.user = null;
            res.locals.userTheme = 'system';
            res.clearCookie('token'); // 유효하지 않은 토큰 제거
        }
    } else {
        res.locals.isAuthenticated = false;
        res.locals.user = null;
        res.locals.userTheme = 'system';
    }
    next();
};

// 실제 보안 검증용 미들웨어 (중요한 액션에 사용)
const requireAuth = (req, res, next) => {
    const token = req.cookies.token;
    
    if (!token) {
        const returnTo = encodeURIComponent(req.originalUrl);
        return res.redirect(`/login?error=로그인이 필요합니다&returnTo=${returnTo}`);
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded; // req.user에 저장 (res.locals와 별도)
        next();
    } catch (error) {
        res.clearCookie('token'); // 유효하지 않은 토큰 제거
        const returnTo = encodeURIComponent(req.originalUrl);
        return res.redirect(`/login?error=세션이 만료되었습니다&returnTo=${returnTo}`);
    }
};

// 로그인한 사용자는 접근 불가 (로그인/회원가입 페이지용)
const requireGuest = (req, res, next) => {
    const token = req.cookies.token;
    
    if (token) {
        try {
            jwt.verify(token, JWT_SECRET);
            return res.redirect('/'); // 이미 로그인된 경우 홈으로 리다이렉트
        } catch (error) {
            res.clearCookie('token'); // 유효하지 않은 토큰 제거
        }
    }
    next();
};

// 로그아웃 처리
const handleLogout = (req, res) => {
    res.clearCookie('token');
    res.redirect('/login?message=로그아웃되었습니다');
};

// 관리자 전용 미들웨어 (admin 계정만 접근 가능)
const requireAdmin = (req, res, next) => {
    const token = req.cookies.token;
    
    if (!token) {
        return res.redirect('/login?error=관리자 로그인이 필요합니다');
    }
    
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // admin 계정인지 확인
        if (decoded.login_id !== 'admin') {
            return res.status(403).render('error', {
                title: '접근 거부',
                statusCode: 403,
                message: '관리자만 접근할 수 있습니다.',
                stack: null,
                layout: 'layouts/main'
            });
        }
        
        req.user = decoded;
        next();
    } catch (error) {
        res.clearCookie('token');
        return res.redirect('/login?error=세션이 만료되었습니다');
    }
};

module.exports = {
    generateToken,
    addAuthState,
    requireAuth,
    requireGuest,
    handleLogout,
    requireAdmin
};
