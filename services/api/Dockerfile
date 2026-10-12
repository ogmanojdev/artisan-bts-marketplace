# Build from the repo root:  docker build -f services/api/Dockerfile .
FROM node:22-slim AS build
WORKDIR /repo
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/
COPY services/api/package.json services/api/
RUN npm install --workspace services/api --include-workspace-root=false --no-audit --no-fund
COPY packages/shared packages/shared
COPY services/api services/api
RUN npm --workspace services/api run build \
 && npm install --workspace services/api --omit=dev --no-audit --no-fund

FROM gcr.io/distroless/nodejs22-debian12
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/services/api/dist ./dist
USER nonroot
CMD ["dist/server.js"]
