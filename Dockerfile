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
EXPOSE 8080

CMD ["node", "server/index.js"]
