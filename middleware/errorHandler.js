// 무시할 경로 목록 (브라우저 자동 요청 등)
const IGNORED_PATHS = [
    '/.well-known/',
    '/favicon.ico',
    '/robots.txt'
];

// 404 Not Found 핸들러
const notFound = (req, res, next) => {
    // 무시할 경로는 로깅 없이 404 반환
    const shouldIgnore = IGNORED_PATHS.some(path => req.originalUrl.startsWith(path));
    if (shouldIgnore) {
        return res.status(404).end();
    }
    
    res.status(404);
    const error = new Error(`페이지를 찾을 수 없습니다: ${req.originalUrl}`);
    next(error);
};

// 전역 에러 핸들러
const errorHandler = (err, req, res, next) => {
    // 상태 코드 결정 (이미 설정된 경우 유지, 아니면 500)
    const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
    
    // 에러 정보 구성
    const errorInfo = {
        statusCode,
        message: err.message || '서버에서 오류가 발생했습니다.',
        // 개발 환경에서만 스택 트레이스 표시
        stack: process.env.NODE_ENV === 'production' ? null : err.stack
    };

    // 콘솔에 에러 로깅
    console.error(`[${new Date().toISOString()}] ${statusCode} - ${err.message}`);
    if (process.env.NODE_ENV !== 'production') {
        console.error(err.stack);
    }

    // API 요청인 경우 JSON 응답
    if (req.xhr || req.headers.accept?.includes('application/json')) {
        return res.status(statusCode).json({
            success: false,
            message: errorInfo.message,
            stack: errorInfo.stack
        });
    }

    // 일반 요청인 경우 에러 페이지 렌더링
    res.status(statusCode).render('error', {
        title: `오류 ${statusCode}`,
        statusCode,
        message: errorInfo.message,
        stack: errorInfo.stack,
        layout: 'layouts/main'
    });
};

// 에러 타입별 헬퍼 함수들
const createError = (statusCode, message) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const badRequest = (message = '잘못된 요청입니다.') => createError(400, message);
const unauthorized = (message = '인증이 필요합니다.') => createError(401, message);
const forbidden = (message = '접근 권한이 없습니다.') => createError(403, message);
const notFoundError = (message = '리소스를 찾을 수 없습니다.') => createError(404, message);

module.exports = {
    notFound,
    errorHandler,
    createError,
    badRequest,
    unauthorized,
    forbidden,
    notFoundError
};
