import express from 'express';
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  loginUser,
  getPendingUsers,
  approveUser,
  rejectUser,
  getMyProfile,
  updateMyProfile,
  requestPasswordReset,
  resetPassword,
} from '../controllers/userController.js';
import { checkAdminPermission } from '../middleware/roleMiddleware.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// 로그인 / 회원가입 라우트 (인증 불필요)
router.post('/login', loginUser);

// 비밀번호 찾기 (인증 불필요) — 로그인 화면에서 사용자가 버튼을 눌렀을 때만 메일이 나간다
router.post('/forgot-password', requestPasswordReset);
router.post('/reset-password', resetPassword);

// 본인 프로필(마이페이지) 조회/수정 - /:id 라우트보다 먼저 선언해야 경로 충돌이 없음
router.route('/me')
  .get(protect, getMyProfile)
  .put(protect, updateMyProfile);

// 승인 대기 목록 및 승인/거절 처리 (/:id 라우트보다 먼저 선언해야 경로 충돌이 없음)
router.get('/pending', protect, checkAdminPermission, getPendingUsers);
router.patch('/:id/approve', protect, checkAdminPermission, approveUser);
router.patch('/:id/reject', protect, checkAdminPermission, rejectUser);

// 모든 유저 조회 및 신규 등록
router.route('/')
  .get(protect, checkAdminPermission, getUsers)
  .post(createUser);

// 특정 ID의 유저 조회, 수정, 삭제
router.route('/:id')
  .get(protect, checkAdminPermission, getUserById)
  .put(protect, checkAdminPermission, updateUser)
  .delete(protect, checkAdminPermission, deleteUser);

export default router;
