export const checkWritePermission = (req, res, next) => {
  // Allow read-only operations for all
  if (req.method === 'GET') {
    return next();
  }

  const userRole = req.headers['x-user-role'] || 'viewer';

  if (userRole === 'viewer') {
    return res.status(403).json({ 
      message: '수정 및 삭제 권한이 없습니다. 관리자 승인을 받으셔야 합니다.' 
    });
  }

  next();
};

// req.user는 protect 미들웨어가 JWT를 검증한 뒤 주입한 실제 DB 유저이며,
// 클라이언트가 임의로 조작할 수 있는 헤더 값이 아니다.
export const checkAdminPermission = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      message: '관리자 권한이 필요합니다.'
    });
  }

  next();
};
