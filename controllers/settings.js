const asyncHandler = require('express-async-handler');
const argon2 = require('argon2');
const { supabase } = require('../config/db');

// @desc 설정 페이지
// @route GET /settings
const getSettingsPage = asyncHandler(async (req, res) => {
    const userId = req.user.user_id;
    
    // 사용자 설정 조회
    const { data: settings } = await supabase
        .from('user_settings')
        .select('theme')
        .eq('user_id', userId)
        .single();
    
    // 사용자 정보 조회
    const { data: user } = await supabase
        .from('app_user')
        .select('nickname, login_id')
        .eq('user_id', userId)
        .single();
    
    res.render('settings/index', {
        title: '설정',
        activeTab: 'settings',
        settings: settings || { theme: 'system' },
        userInfo: user
    });
});

// @desc 닉네임 변경
// @route POST /settings/nickname
const updateNickname = asyncHandler(async (req, res) => {
    const userId = req.user.user_id;
    const { nickname } = req.body;
    
    // 닉네임 검증
    if (!nickname || nickname.length < 2) {
        return res.status(400).json({ 
            success: false, 
            message: '닉네임은 2자 이상이어야 합니다.' 
        });
    }
    
    if (nickname.length > 32) {
        return res.status(400).json({ 
            success: false, 
            message: '닉네임은 32자 이하여야 합니다.' 
        });
    }
    
    // 닉네임 업데이트
    const { error } = await supabase
        .from('app_user')
        .update({ nickname })
        .eq('user_id', userId);
    
    if (error) {
        console.error('Nickname update error:', error);
        return res.status(500).json({ 
            success: false, 
            message: '닉네임 변경에 실패했습니다.' 
        });
    }
    
    res.json({ 
        success: true, 
        message: '닉네임이 변경되었습니다.',
        nickname
    });
});

// @desc 비밀번호 변경
// @route POST /settings/password
const updatePassword = asyncHandler(async (req, res) => {
    const userId = req.user.user_id;
    const { currentPassword, newPassword, confirmPassword } = req.body;
    
    // 입력 검증
    if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ 
            success: false, 
            message: '모든 필드를 입력해주세요.' 
        });
    }
    
    if (newPassword.length < 8) {
        return res.status(400).json({ 
            success: false, 
            message: '새 비밀번호는 8자 이상이어야 합니다.' 
        });
    }
    
    if (newPassword !== confirmPassword) {
        return res.status(400).json({ 
            success: false, 
            message: '새 비밀번호가 일치하지 않습니다.' 
        });
    }
    
    // 현재 비밀번호 확인
    const { data: user, error: fetchError } = await supabase
        .from('app_user')
        .select('password_hash')
        .eq('user_id', userId)
        .single();
    
    if (fetchError || !user) {
        return res.status(500).json({ 
            success: false, 
            message: '사용자 정보를 가져올 수 없습니다.' 
        });
    }
    
    // 현재 비밀번호 검증
    let isValidPassword = false;
    try {
        isValidPassword = await argon2.verify(user.password_hash, currentPassword);
    } catch (err) {
        console.error('Password verification error:', err);
        return res.status(500).json({ 
            success: false, 
            message: '비밀번호 확인 중 오류가 발생했습니다.' 
        });
    }
    
    if (!isValidPassword) {
        return res.status(400).json({ 
            success: false, 
            message: '현재 비밀번호가 일치하지 않습니다.' 
        });
    }
    
    // 새 비밀번호 해싱
    const newPasswordHash = await argon2.hash(newPassword);
    
    // 비밀번호 업데이트
    const { error: updateError } = await supabase
        .from('app_user')
        .update({ password_hash: newPasswordHash })
        .eq('user_id', userId);
    
    if (updateError) {
        console.error('Password update error:', updateError);
        return res.status(500).json({ 
            success: false, 
            message: '비밀번호 변경에 실패했습니다.' 
        });
    }
    
    res.json({ 
        success: true, 
        message: '비밀번호가 변경되었습니다.' 
    });
});

// @desc 테마 변경
// @route POST /settings/theme
const updateTheme = asyncHandler(async (req, res) => {
    const userId = req.user.user_id;
    const { theme } = req.body;
    
    // 테마 검증
    const validThemes = ['light', 'dark', 'system'];
    if (!validThemes.includes(theme)) {
        return res.status(400).json({ 
            success: false, 
            message: '유효하지 않은 테마입니다.' 
        });
    }
    
    // user_settings가 없으면 생성, 있으면 업데이트 (upsert)
    const { error } = await supabase
        .from('user_settings')
        .upsert({ 
            user_id: userId, 
            theme,
            updated_at: new Date().toISOString()
        }, { 
            onConflict: 'user_id' 
        });
    
    if (error) {
        console.error('Theme update error:', error);
        return res.status(500).json({ 
            success: false, 
            message: '테마 변경에 실패했습니다.' 
        });
    }
    
    res.json({ 
        success: true, 
        message: '테마가 변경되었습니다.',
        theme
    });
});

// @desc 현재 사용자 설정 조회 (API)
// @route GET /api/settings
const getUserSettings = asyncHandler(async (req, res) => {
    const userId = req.user?.user_id;
    
    if (!userId) {
        return res.json({ theme: 'system' });
    }
    
    const { data: settings } = await supabase
        .from('user_settings')
        .select('theme')
        .eq('user_id', userId)
        .single();
    
    res.json(settings || { theme: 'system' });
});

module.exports = {
    getSettingsPage,
    updateNickname,
    updatePassword,
    updateTheme,
    getUserSettings
};
