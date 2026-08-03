import express from 'express';
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  loginUser,
} from '../controllers/userController.js';
import { checkAdminPermission } from '../middleware/roleMiddleware.js';

const router = express.Router();

// 로그인 라우트
router.post('/login', loginUser);

// 모든 유저 조회 및 신규 등록
router.route('/')
  .get(checkAdminPermission, getUsers)
  .post(createUser);

// 특정 ID의 유저 조회, 수정, 삭제
router.route('/:id')
  .get(checkAdminPermission, getUserById)
  .put(checkAdminPermission, updateUser)
  .delete(checkAdminPermission, deleteUser);

export default router;
