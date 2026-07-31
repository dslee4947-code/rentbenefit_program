import jwt from 'jsonwebtoken';

/**
 * JWT 토큰을 생성하는 함수
 * @param {string} id - 유저 DB ID
 * @returns {string} JWT 토큰
 */
const generateToken = (id) => {
  // .env에 JWT_SECRET이 없을 때 대비한 기본 키값 지정
  const secret = process.env.JWT_SECRET || 'rentbenefitsecretkey12345';
  
  return jwt.sign({ id }, secret, {
    expiresIn: '30d', // 30일간 유효
  });
};

export default generateToken;
