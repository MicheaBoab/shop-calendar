# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
COPY backend/prisma ./backend/prisma
COPY backend/prisma.config.ts ./backend/prisma.config.ts
WORKDIR /app/backend
RUN npm ci
RUN npx prisma generate

WORKDIR /app
COPY shared ./shared
COPY backend ./backend
WORKDIR /app/backend
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app/backend
ENV NODE_ENV=production

COPY --from=build /app/backend/package.json /app/backend/package-lock.json ./
COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/backend/prisma.config.ts ./prisma.config.ts
RUN npm ci --omit=dev
RUN npx prisma generate

COPY --from=build /app/backend/dist ./dist

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/backend/src/main.js"]
