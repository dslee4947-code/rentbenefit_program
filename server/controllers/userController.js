import User from '../models/User.js';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import generateToken from '../utils/generateToken.js';
import { sendPasswordResetMail } from '../utils/mailService.js';

const PASSWORD_POLICY = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>_\-]).{8,}$/;
const PASSWORD_POLICY_MESSAGE = '비밀번호는 영문, 숫자, 특수문자를 포함하여 8자 이상이어야 합니다.';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ['viewer', 'editor', 'admin'];
const STATUSES = ['PENDING', 'ACTIVE', 'REJECTED', 'SUSPENDED'];
const RESET_CODE_MINUTES = 10;
const RESET_MAX_ATTEMPTS = 5;
const RESET_RESEND_SECONDS = 60;

/** 응답에서 비밀번호와 인증번호를 뺀다 */
const publicUser = (user) => {
  const obj = user.toObject ? user.toObject() : { ...user };
  delete obj.password;
  delete obj.passwordReset;
  return obj;
};

// @desc    승인 대기 중인 유저 목록 조회
// @route   GET /api/users/pending
// @access  Admin
export const getPendingUsers = async (req, res) => {
  try {
    const users = await User.find({ status: 'PENDING' }).select('-password -passwordReset').sort({ createdAt: 1 });
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    가입 승인 처리 (권한 부여 및 status -> ACTIVE)
// @route   PATCH /api/users/:id/approve
// @access  Admin
export const approveUser = async (req, res) => {
  try {
    const { role } = req.body;
    const allowedRoles = ['viewer', 'editor', 'admin'];
    if (!role || !allowedRoles.includes(role)) {
      return res.status(400).json({ message: '올바른 권한(role)을 선택해주세요.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.status = 'ACTIVE';
    user.role = role;
    user.rejectionReason = '';
    const updatedUser = await user.save();

    const userResponse = publicUser(updatedUser);
    res.json(userResponse);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    가입 거절 처리 (status -> REJECTED)
// @route   PATCH /api/users/:id/reject
// @access  Admin
export const rejectUser = async (req, res) => {
  try {
    const { reason } = req.body;

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    user.status = 'REJECTED';
    user.rejectionReason = reason || '';
    const updatedUser = await user.save();

    const userResponse = publicUser(updatedUser);
    res.json(userResponse);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    모든 유저 조회
// @route   GET /api/users
// @access  Public
export const getUsers = async (req, res) => {
  try {
    // 보안을 위해 조회 결과에서 비밀번호(password) 제외
    const users = await User.find({}).select('-password -passwordReset');
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    특정 ID의 유저 조회
// @route   GET /api/users/:id
// @access  Public
export const getUserById = async (req, res) => {
  try {
    // 특정 ID의 유저를 조회하되 비밀번호 필드 제외
    const user = await User.findById(req.params.id).select('-password -passwordReset');
    if (user) {
      res.json(user);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    신규 유저 등록 (생성) - 관리자 승인 전까지는 PENDING 상태로 저장되며 로그인 불가
// @route   POST /api/users
// @access  Public
export const createUser = async (req, res) => {
  try {
    const { email, name, password, phone, department, applyReason, address, agreedToTerms } = req.body;

    if (!email || !name || !password || !phone || !department) {
      return res.status(400).json({ message: '이메일, 비밀번호, 이름, 연락처, 소속은 필수 입력 항목입니다.' });
    }

    if (!agreedToTerms) {
      return res.status(400).json({ message: '이용약관 및 개인정보 수집·이용에 동의해야 가입할 수 있습니다.' });
    }

    const passwordPolicy = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>_\-]).{8,}$/;
    if (!passwordPolicy.test(password)) {
      return res.status(400).json({ message: '비밀번호는 영문, 숫자, 특수문자를 포함하여 8자 이상이어야 합니다.' });
    }

    // 이미 가입된 이메일이 있는지 확인
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // 신규 유저 인스턴스 생성 (비밀번호는 User 모델의 pre-save 훅을 통해 자동 해싱됨)
    // user_type / role / status는 클라이언트 입력을 신뢰하지 않고 서버에서 고정한다.
    const user = new User({
      email,
      name,
      password,
      phone,
      department,
      applyReason: applyReason || '',
      address,
      agreedToTerms: true,
      user_type: 'customer',
      role: 'viewer',
      status: 'PENDING',
    });

    // DB에 저장
    const createdUser = await user.save();

    // 승인 전이므로 토큰은 발급하지 않는다 (자동 로그인 방지)
    const userResponse = publicUser(createdUser);

    res.status(201).json(userResponse);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    유저 정보 수정 (사용자 권한 관리 — 최고 관리자만)
// @route   PUT /api/users/:id
// @access  Admin
export const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const body = req.body || {};
    const isSelf = String(user._id) === String(req.user?._id);

    // 자기 권한·상태를 스스로 내리면 관리자가 아무도 없게 될 수 있어 막는다
    if (isSelf && body.role !== undefined && body.role !== user.role) {
      return res.status(400).json({ message: '자기 자신의 권한은 바꿀 수 없습니다.' });
    }
    if (isSelf && body.status !== undefined && body.status !== user.status) {
      return res.status(400).json({ message: '자기 자신의 상태는 바꿀 수 없습니다.' });
    }

    for (const key of ['name', 'phone', 'department']) {
      if (body[key] !== undefined) {
        const v = String(body[key]).trim();
        if (!v) return res.status(400).json({ message: '이름, 연락처, 소속은 비워 둘 수 없습니다.' });
        user[key] = v;
      }
    }
    if (body.address !== undefined) user.address = String(body.address);
    if (body.applyReason !== undefined) user.applyReason = String(body.applyReason);

    if (body.email !== undefined) {
      const email = String(body.email).trim().toLowerCase();
      if (!email) return res.status(400).json({ message: '아이디(이메일)를 입력해 주세요.' });
      // 예전부터 rent-003 같은 아이디 계정이 있어 '@'가 있을 때만 이메일 형식을 본다
      if (email.includes('@') && !EMAIL_PATTERN.test(email)) {
        return res.status(400).json({ message: '올바른 이메일 형식이 아닙니다.' });
      }
      if (email !== user.email) {
        const existing = await User.findOne({ email, _id: { $ne: user._id } });
        if (existing) return res.status(400).json({ message: '이미 사용 중인 아이디(이메일)입니다.' });
        user.email = email;
      }
    }

    if (body.password) {
      if (!PASSWORD_POLICY.test(body.password)) return res.status(400).json({ message: PASSWORD_POLICY_MESSAGE });
      user.password = body.password; // User 모델의 pre-save 훅을 통해 자동 해싱 처리됨
      user.passwordReset = { codeHash: '', attempts: 0 };
    }
    if (body.user_type !== undefined) {
      if (!['customer', 'admin'].includes(body.user_type)) return res.status(400).json({ message: '사용자 구분이 올바르지 않습니다.' });
      user.user_type = body.user_type;
    }
    if (body.role !== undefined) {
      if (!ROLES.includes(body.role)) return res.status(400).json({ message: '올바른 권한(role)을 선택해주세요.' });
      user.role = body.role;
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status)) return res.status(400).json({ message: '상태 값이 올바르지 않습니다.' });
      user.status = body.status;
    }
    if (typeof body.financeTeam === 'boolean') user.financeTeam = body.financeTeam;

    const updatedUser = await user.save();
    res.json(publicUser(updatedUser));
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    비밀번호 찾기 1단계 — 아이디(이메일)와 이름이 맞으면 인증번호를 메일로 보낸다
// @route   POST /api/users/forgot-password
// @access  Public
// 계정이 있는지 없는지는 알려 주지 않는다. 사용자가 버튼을 눌렀을 때만 메일이 나간다.
export const requestPasswordReset = async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const name = String(req.body?.name || '').trim();
  const generic = { message: '입력하신 정보가 맞으면 인증번호를 메일로 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요.' };
  try {
    if (!email || !name) return res.status(400).json({ message: '아이디(이메일)와 이름을 입력해 주세요.' });
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ message: '이메일이 아닌 아이디는 메일로 찾을 수 없습니다. 관리자에게 비밀번호 초기화를 요청해 주세요.' });
    }
    const user = await User.findOne({ email });
    const sameName = (a, b) => String(a || '').replace(/\s/g, '') === String(b || '').replace(/\s/g, '');
    if (!user || !sameName(user.name, name) || user.status !== 'ACTIVE') return res.json(generic);

    const last = user.passwordReset?.requestedAt ? new Date(user.passwordReset.requestedAt).getTime() : 0;
    if (Date.now() - last < RESET_RESEND_SECONDS * 1000) {
      return res.status(429).json({ message: `인증번호는 ${RESET_RESEND_SECONDS}초에 한 번만 받을 수 있습니다. 잠시 후 다시 눌러 주세요.` });
    }

    const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    user.passwordReset = {
      codeHash: await bcrypt.hash(code, 10),
      expiresAt: new Date(Date.now() + RESET_CODE_MINUTES * 60 * 1000),
      attempts: 0,
      requestedAt: new Date()
    };
    await user.save();
    await sendPasswordResetMail({ to: user.email, name: user.name, code });
    res.json(generic);
  } catch (error) {
    console.error('[비밀번호 찾기]', error.message);
    res.status(500).json({ message: '인증번호 메일을 보내지 못했습니다. 관리자에게 비밀번호 초기화를 요청해 주세요.' });
  }
};

// @desc    비밀번호 찾기 2단계 — 인증번호를 확인하고 새 비밀번호로 바꾼다
// @route   POST /api/users/reset-password
// @access  Public
export const resetPassword = async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    if (!email || !code || !newPassword) return res.status(400).json({ message: '인증번호와 새 비밀번호를 입력해 주세요.' });

    const user = await User.findOne({ email });
    const reset = user?.passwordReset;
    const invalid = { message: '인증번호가 맞지 않거나 시간이 지났습니다. 인증번호를 다시 받아 주세요.' };
    if (!user || !reset?.codeHash || !reset.expiresAt || new Date(reset.expiresAt) < new Date()) {
      return res.status(400).json(invalid);
    }
    if ((reset.attempts || 0) >= RESET_MAX_ATTEMPTS) {
      return res.status(400).json({ message: `인증번호를 ${RESET_MAX_ATTEMPTS}번 틀렸습니다. 인증번호를 다시 받아 주세요.` });
    }
    if (!(await bcrypt.compare(code, reset.codeHash))) {
      user.passwordReset.attempts = (reset.attempts || 0) + 1;
      await user.save();
      return res.status(400).json(invalid);
    }
    if (!PASSWORD_POLICY.test(newPassword)) return res.status(400).json({ message: PASSWORD_POLICY_MESSAGE });

    user.password = newPassword; // pre-save 훅에서 해싱
    user.passwordReset = { codeHash: '', attempts: 0 };
    await user.save();
    res.json({ message: '비밀번호를 바꿨습니다. 새 비밀번호로 로그인해 주세요.' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    유저 삭제
// @route   DELETE /api/users/:id
// @access  Public
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (user) {
      // 유저 삭제 실행
      await User.deleteOne({ _id: req.params.id });
      res.json({ message: 'User removed successfully' });
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    로그인한 본인 프로필 조회 (마이페이지)
// @route   GET /api/users/me
// @access  Private
export const getMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -passwordReset');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// @desc    로그인한 본인 프로필 수정 (이름/연락처/소속/주소/아이디(이메일)/비밀번호) - 권한/상태는 변경 불가
// @route   PUT /api/users/me
// @access  Private
export const updateMyProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const { name, phone, department, address, email, currentPassword, newPassword } = req.body;

    if (name !== undefined) user.name = name;
    if (phone !== undefined) user.phone = phone;
    if (department !== undefined) user.department = department;
    if (address !== undefined) user.address = address;

    const normalizedEmail = email !== undefined ? String(email).trim().toLowerCase() : undefined;
    const emailChanged = normalizedEmail !== undefined && normalizedEmail !== user.email;

    // 아이디(이메일) 또는 비밀번호처럼 민감한 정보를 바꿀 때는 현재 비밀번호 확인이 필요하다.
    if (emailChanged || newPassword) {
      if (!currentPassword || !(await user.matchPassword(currentPassword))) {
        return res.status(401).json({ message: '현재 비밀번호가 일치하지 않습니다.' });
      }
    }

    if (emailChanged) {
      const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailPattern.test(normalizedEmail)) {
        return res.status(400).json({ message: '올바른 이메일 형식이 아닙니다.' });
      }
      const existing = await User.findOne({ email: normalizedEmail, _id: { $ne: user._id } });
      if (existing) {
        return res.status(400).json({ message: '이미 사용 중인 이메일입니다.' });
      }
      user.email = normalizedEmail;
    }

    if (newPassword) {
      const passwordPolicy = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[!@#$%^&*(),.?":{}|<>_\-]).{8,}$/;
      if (!passwordPolicy.test(newPassword)) {
        return res.status(400).json({ message: '비밀번호는 영문, 숫자, 특수문자를 포함하여 8자 이상이어야 합니다.' });
      }
      user.password = newPassword; // User 모델의 pre-save 훅을 통해 자동 해싱됨
    }

    const updatedUser = await user.save();
    const userResponse = publicUser(updatedUser);
    res.json(userResponse);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    유저 로그인 (인증 및 토큰 발급)
// @route   POST /api/users/login
// @access  Public
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. 필수 입력값 체크
    if (!email || !password) {
      return res.status(400).json({ message: 'Please provide email and password' });
    }

    // 2. 이메일로 유저 검색
    const user = await User.findOne({ email });

    // 3. 비밀번호 일치 확인 (User 모델의 matchPassword 메소드 활용)
    if (!user || !(await user.matchPassword(password))) {
      // 보안상 구체적인 원인(비밀번호 불일치 vs 이메일 없음)은 숨기고 실패 처리
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    // 4. 승인 상태 확인 - 승인 대기/거절/정지 상태는 로그인 자체를 차단
    if (user.status === 'PENDING') {
      return res.status(403).json({ message: '현재 관리자 승인 대기 중입니다. 승인 완료 후 이용 가능합니다.' });
    }
    if (user.status === 'REJECTED') {
      const reasonText = user.rejectionReason ? ` (사유: ${user.rejectionReason})` : '';
      return res.status(403).json({ message: `가입 신청이 거절되었습니다.${reasonText}` });
    }
    if (user.status === 'SUSPENDED') {
      return res.status(403).json({ message: '이용이 정지된 계정입니다. 관리자에게 문의해주세요.' });
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      user_type: user.user_type,
      role: user.role || 'viewer', // Include role in response
      financeTeam: user.financeTeam === true,
      status: user.status,
      address: user.address,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

