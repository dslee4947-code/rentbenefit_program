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

export const checkAdminPermission = (req, res, next) => {
  const userRole = req.headers['x-user-role'] || 'viewer';

  if (userRole !== 'admin') {
    return res.status(403).json({ 
      message: '관리자 권한이 필요합니다.' 
    });
  }

  next();
};
