# bbz-erp: API + PWA (+ optional Worker). Build: docker build -t bbz-erp .
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund --include=dev
COPY tsconfig.json ./
COPY src ./src
COPY db ./db
COPY web ./web
COPY widget ./widget
COPY tools ./tools
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["npx", "tsx", "src/server/main.ts"]
