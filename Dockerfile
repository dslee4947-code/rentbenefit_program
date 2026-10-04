# 서버(API)만 담는다. 화면은 Vercel이 맡고 있어 여기서 만들지 않는다.
# 그래서 배포가 빠르고 이미지도 작다.
FROM node:20-alpine

WORKDIR /app

# 라이브러리 먼저 설치한다. 코드만 바뀌었을 때 이 단계를 건너뛰어 배포가 빨라진다.
COPY server/package.json server/package-lock.json ./server/
RUN npm ci --omit=dev --prefix server

COPY server ./server

ENV NODE_ENV=production
ENV PORT=8080

# 서버 시간을 한국 시간으로 둔다.
# 코드 곳곳이 new Date()의 '오늘'을 한국 날짜로 여기고 계산한다(청구 일정, 고지서 기한 등).
# 이 줄이 없으면 컨테이너가 UTC라 한국 새벽 0~9시에는 '오늘'이 전날로 잡힌다.
ENV TZ=Asia/Seoul
EXPOSE 8080

CMD ["node", "server/index.js"]
