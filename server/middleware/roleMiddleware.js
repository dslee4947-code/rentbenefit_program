/**
 * 쓰기 권한 확인.
 *
 * 예전에는 'x-user-role' 헤더를 보고 판단했다. 그 값은 브라우저가 보내는 것이라
 * 조회 권한만 받은 사람도 헤더 한 줄만 바꾸면 수정·삭제까지 할 수 있었다.
 * 지금은 protect가 JWT를 검사해 넣어 준 실제 DB 유저(req.user)만 본다.
 *
 * 이 미들웨어를 쓰는 라우트에는 반드시 protect가 먼저 걸려 있어야 한다.
 * (index.js에서 /api/* 전체에 걸어 두었다)
 */
export const checkWritePermission = (req, res, next) => {
  // 조회는 로그인한 사람이면 누구나 할 수 있다. 로그인 자체는 protect가 이미 확인했다.
  if (req.method === 'GET') {
    return next();
  }

  const user = req.user;

  if (!user) {
    return res.status(401).json({
      message: '로그인이 필요합니다. 다시 로그인해 주세요.'
    });
  }

  if (user.role === 'viewer') {
    return res.status(403).json({
      message: '수정 및 삭제 권한이 없습니다. 관리자 승인을 받으셔야 합니다.'
    });
  }

  next();
};

// 자금팀 메뉴(회사 자금·내부 금리, 회사 장부, 차량별 감가상각)는 사용자 권한 관리에서 '자금팀'을 켠 사람만 본다.
// 고치기는 거기에 더해 조회 권한(viewer)이 아니어야 한다.
export const checkFinancePermission = (req, res, next) => {
  if (!req.user || req.user.financeTeam !== true) {
    return res.status(403).json({
      message: '자금팀 권한이 필요합니다. 사용자 권한 관리에서 자금팀을 켜 주세요.'
    });
  }
  if (req.method !== 'GET' && req.user.role === 'viewer') {
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
