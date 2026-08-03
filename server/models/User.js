import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

// 유저 스키마 정의
const userSchema = new mongoose.Schema(
  {
    // 이메일 (필수, 중복 불가, 공백 제거, 소문자 변환)
    email: {
      type: String,
      required: [true, 'Please add an email'],
      unique: true,
      trim: true,
      lowercase: true,
    },
    // 이름 (필수, 공백 제거)
    name: {
      type: String,
      required: [true, 'Please add a name'],
      trim: true,
    },
    // 비밀번호 (필수)
    password: {
      type: String,
      required: [true, 'Please add a password'],
    },
    // 유저 타입 (필수, customer 또는 admin만 허용, 기본값 customer)
    user_type: {
      type: String,
      required: [true, 'Please specify user type'],
      enum: ['customer', 'admin'],
      default: 'customer',
    },
    // 권한 역할 (admin, editor, viewer 중 하나, 기본값 viewer)
    role: {
      type: String,
      enum: ['viewer', 'editor', 'admin'],
      default: 'viewer'
    },
    // 주소 (선택 사항)
    address: {
      type: String,
      default: '',
    },
  },
  {
    // 생성일(createdAt) 및 수정일(updatedAt) 자동 기록
    timestamps: true,
  }
);

// 저장 전 비밀번호 암호화 (pre-save hook)
userSchema.pre('save', async function (next) {
  // 비밀번호 필드가 수정되지 않았으면 다음 미들웨어로 넘어감
  if (!this.isModified('password')) {
    return next();
  }

  try {
    // 10 라운드의 Salt 생성 및 해싱
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// 비밀번호 검증 메소드 (로그인 기능 구현 시 활용 가능)
userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

const User = mongoose.models.User || mongoose.model('User', userSchema);

export default User;
