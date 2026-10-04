import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // 견적 계산식은 서버와 같이 쓰려고 저장소 맨 위 shared 폴더에 둔다.
      // 개발 서버는 기본적으로 client 폴더 밖 파일을 막으므로 shared를 열어 준다.
      allow: ['.', '../shared']
    }
  }
})
