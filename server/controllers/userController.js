import User from '../models/User.js';
import generateToken from '../utils/generateToken.js';

// @desc    승인 대기 중인 유저 목록 조회
// @route   GET /api/users/pending
// @access  Admin
export const getPendingUsers = async (req, res) => {
  try {
    const users = await User.find({ status: 'PENDING' }).select('-password').sort({ createdAt: 1 });
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

    const userResponse = updatedUser.toObject();
    delete userResponse.password;
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

    const userResponse = updatedUser.toObject();
    delete userResponse.password;
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
    const users = await User.find({}).select('-password');
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
    const user = await User.findById(req.params.id).select('-password');
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
    const userResponse = createdUser.toObject();
    delete userResponse.password;

    res.status(201).json(userResponse);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
};

// @desc    유저 정보 수정
// @route   PUT /api/users/:id
// @access  Public
export const updateUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (user) {
      // 입력받은 정보가 있을 때만 수정 처리
      user.name = req.body.name || user.name;
      user.email = req.body.email || user.email;
      if (req.body.password) {
        user.password = req.body.password; // User 모델의 pre-save 훅을 통해 자동 해싱 처리됨
      }
      if (req.body.user_type) {
        user.user_type = req.body.user_type;
      }
      if (req.body.role) {
        user.role = req.body.role;
      }
      if (req.body.status) {
        user.status = req.body.status;
      }
      if (req.body.address !== undefined) {
        user.address = req.body.address;
      }

      // 수정된 데이터 저장
      const updatedUser = await user.save();
      
      // 반환 데이터에서 비밀번호 삭제
      const userResponse = updatedUser.toObject();
      delete userResponse.password;

      res.json(userResponse);
    } else {
      res.status(404).json({ message: 'User not found' });
    }
  } catch (error) {
    res.status(400).json({ message: error.message });
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
    const user = await User.findById(req.user._id).select('-password');
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
    const userResponse = updatedUser.toObject();
    delete userResponse.password;
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
      status: user.status,
      address: user.address,
      token: generateToken(user._id),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

