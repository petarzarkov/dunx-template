# Runs from source. `bun src/main.ts` is the shape dunx documents for
# deployment: Bun transpiles on the fly and `@dunx/transform/preload` records
# constructor parameter types at load time.
#
# That makes `@dunx/transform` a **runtime** dependency, not a build-time one, and
# makes `bunfig.toml` load-bearing in the image. Both are easy to lose to a
# `--production` install or an allowlist-shaped .dockerignore.
FROM oven/bun:1.3.14-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.14-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    APP_ENV=prod \
    TZ=UTC \
    API_PORT=3001 \
    SQLITE_DB_PATH=/app/data/app.db

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bunfig.toml ./
COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/data && chown -R bun:bun /app/data
USER bun

ARG COMMIT_SHA
ARG COMMIT_MESSAGE
ENV SERVICE_COMMIT_SHA=$COMMIT_SHA \
    SERVICE_COMMIT_MESSAGE=$COMMIT_MESSAGE

EXPOSE 3001

# Readiness, not liveness: it probes the database. A liveness probe that checks a
# dependency restarts the process when the dependency blinks.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${API_PORT}/api/service/health" || exit 1

CMD ["bun", "src/main.ts"]
