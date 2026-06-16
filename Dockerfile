# BL Crusher Manager — web server image.
#
# The desktop build compiles better-sqlite3 against Electron's ABI (via the
# package.json "postinstall"). For the server we need it built against plain
# Node, so we install with --ignore-scripts and rebuild better-sqlite3 here.
FROM node:20-bookworm-slim

# Build tools for compiling the native better-sqlite3 addon if no prebuilt
# binary is available for this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install dependencies without running the Electron-oriented postinstall.
COPY package*.json ./
RUN npm ci --ignore-scripts

# Build the web bundle (renderer static files + bundled server) and make sure
# the SQLite addon matches this image's Node runtime.
COPY . .
RUN npm rebuild better-sqlite3 \
  && npm run build:web

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    BL_DB_DIR=/data \
    SECURE_COOKIE=1

# Persist the SQLite database on a mounted volume so redeploys keep the data.
VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "dist-server/index.cjs"]
