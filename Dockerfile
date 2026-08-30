# OnStarJS auth drives a real (patchright/Chromium) browser for GM login,
# so the image needs Chromium's runtime libraries.
FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    xvfb \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Pin browser install location so it bakes into the image (not per-user cache)
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json* ./
# onstarjs2's postinstall runs "patchright install chromium"
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production \
    ONSTAR_TOKEN_LOCATION=/app/tokens/ \
    TZ=America/Chicago
VOLUME ["/app/tokens"]

CMD ["node", "src/index.js"]
