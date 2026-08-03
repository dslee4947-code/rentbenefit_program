import User from '../models/user.js';
import generateToken from '../utils/generateToken.js';

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

// @desc    신규 유저 등록 (생성)
// @route   POST /api/users
// @access  Public
export const createUser = async (req, res) => {
  try {
    const { email, name, password, user_type, address } = req.body;

    // 이미 가입된 이메일이 있는지 확인
    const userExists = await User.findOne({ email });
    if (userExists) {
      return res.status(400).json({ message: 'User already exists with this email' });
    }

    // 신규 유저 인스턴스 생성 (비밀번호는 User 모델의 pre-save 훅을 통해 자동 해싱됨)
    const user = new User({
      email,
      name,
      password,
      user_type,
      role: 'viewer', // Default new signups to viewer role
      address,
    });

    // DB에 저장
    const createdUser = await user.save();
    
    // 응답값 반환 전 객체에서 비밀번호 제거 및 JWT 토큰 포함
    const userResponse = createdUser.toObject();
    delete userResponse.password;
    userResponse.token = generateToken(createdUser._id);

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
    if (user && (await user.matchPassword(password))) {
      res.json({
        _id: user._id,
        name: user.name,
        email: user.email,
        user_type: user.user_type,
        role: user.role || 'viewer', // Include role in response
        address: user.address,
        token: generateToken(user._id),
      });
    } else {
      // 보안상 구체적인 원인(비밀번호 불일치 vs 이메일 없음)은 숨기고 실패 처리
      res.status(401).json({ message: 'Invalid email or password' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

