# syntax=docker/dockerfile:1
FROM node:20-alpine AS build
WORKDIR /app

COPY backend/package.json backend/package-lock.json ./backend/
COPY backend/prisma ./backend/prisma
WORKDIR /app/backend
RUN npm ci

WORKDIR /app
COPY backend ./backend
WORKDIR /app/backend
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app/backend
ENV NODE_ENV=production

COPY --from=build /app/backend/package.json /app/backend/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/backend/prisma ./prisma
COPY --from=build /app/backend/dist ./dist

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/backend/src/main.js"]
