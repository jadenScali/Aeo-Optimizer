FROM node:20-alpine
RUN apk add --no-cache openssl
RUN corepack enable && corepack prepare pnpm@10.27.0 --activate

WORKDIR /app
ENV NODE_ENV=production
ENV CI=true

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec prisma generate
RUN pnpm run build
RUN pnpm prune --prod && pnpm store prune

EXPOSE 3000
CMD ["pnpm", "run", "docker-start"]