import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// 요청 헤더의 JWT를 검증하고 req.user에 실제 DB 유저를 주입한다.
// (클라이언트가 보내는 role 값을 그대로 신뢰하지 않기 위함)
export const protect = async (req, res, next) => {
  let token;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ message: '인증 토큰이 필요합니다. 로그인 후 다시 시도해주세요.' });
  }

  try {
    const secret = process.env.JWT_SECRET || 'rentbenefitsecretkey12345';
    const decoded = jwt.verify(token, secret);

    const user = await User.findById(decoded.id).select('-password');
    if (!user) {
      return res.status(401).json({ message: '유효하지 않은 계정입니다.' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: '인증 토큰이 유효하지 않습니다.' });
  }
};
