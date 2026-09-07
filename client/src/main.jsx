import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import { installAuthFetch } from './utils/authFetch.js'

// 서버로 나가는 요청에 로그인 토큰을 붙인다.
// 화면이 그려지기 전에 걸어 둬야 첫 화면의 요청부터 토큰이 실린다.
installAuthFetch(() => {
  // 토큰이 만료됐거나 계정이 사라졌다. 로그인 화면으로 돌려보낸다.
  localStorage.removeItem('currentUser')
  window.location.hash = ''
  window.location.reload()
})

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60 * 1000,
      refetchOnWindowFocus: false
    }
  }
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
