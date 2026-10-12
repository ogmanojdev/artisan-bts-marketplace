# Build from the repo root:  docker build -f services/transcoder/Dockerfile .
FROM node:22-trixie-slim AS build
WORKDIR /repo
COPY services/transcoder/package.json services/transcoder/
RUN cd services/transcoder && npm install --no-audit --no-fund
COPY services/transcoder services/transcoder
RUN cd services/transcoder && npm run build && npm install --omit=dev --no-audit --no-fund

FROM node:22-trixie-slim
# Debian trixie's FFmpeg 7.x ships libsvtav1, libdav1d, libopus, libx264 and libwebp.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && ffmpeg -hide_banner -encoders | grep -E "libsvtav1|libopus|libx264|libwebp" | wc -l | grep -q 4

ARG PACKAGER_VERSION=v3.9.3
RUN curl -fsSL -o /usr/local/bin/packager \
      "https://github.com/shaka-project/shaka-packager/releases/download/${PACKAGER_VERSION}/packager-linux-x64" \
 && chmod +x /usr/local/bin/packager \
 && packager --version

WORKDIR /app
COPY --from=build /repo/services/transcoder/node_modules ./node_modules
COPY --from=build /repo/services/transcoder/dist ./dist
USER node
CMD ["node", "dist/main.js"]
