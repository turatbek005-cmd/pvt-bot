# ЭТАП 1: Сборка и компиляция проекта
FROM node:20-alpine AS builder
WORKDIR /app


COPY package*.json ./
RUN npm ci

COPY . .

RUN npx prisma generate


RUN npm run build

FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
#
RUN npm ci --only=production


COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/views ./views
COPY --from=builder /app/public ./public
COPY --from=builder /app/documents ./documents
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts


RUN npx prisma generate


EXPOSE 3000


CMD ["node", "dist/src/main.js"]