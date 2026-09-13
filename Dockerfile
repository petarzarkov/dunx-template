# Runs from source. `bun src/main.ts` is the shape dunx documents for
# deployment: Bun transpiles on the fly and `@dunx/transform/preload` records
# constructor parameter types at load time.
#
# That makes `@dunx/transform` a **runtime** dependency, not a build-time one, and
# makes `bunfig.toml` load-bearing in the image. Both are easy to lose to a
# `--production` install or an allowlist-shaped .dockerignore.
FROM oven/bun:1.4.2-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
# `--ignore-scripts` because `prepare` runs `scripts/install-hooks.ts`, which is
# not in this stage and would not be wanted if it were: an image has no git
# repository and no commits to hook. Without it the build fails on a missing
# module, which reads as a dependency problem and is not one.
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM oven/bun:1.4.2-slim AS runtime
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

# `APP_ENV=prod` makes `BETTER_AUTH_SECRET` mandatory, so this image refuses to
# boot without one - the development fallback is a constant in the repository and
# anyone holding it can mint a session. Pass it with `-e BETTER_AUTH_SECRET=...`.
#
# Nothing else is required. With no `REDIS_URL` the cache, the queue and the
# websocket relay all report themselves degraded and the container still serves.
ENV NODE_ENV=production \
    APP_ENV=prod \
    TZ=UTC \
    API_PORT=3001 \
    SQLITE_DB_PATH=/app/data/app.db \
    STORAGE_LOCAL_ROOT=/app/data/uploads

COPY --from=deps /app/node_modules ./node_modules
COPY package.json bunfig.toml ./
COPY src ./src
COPY scripts ./scripts
# `StaticFiles` serves this, and `STATIC_ROOT` defaults to ./public relative to
# WORKDIR. Without it the chat client is a 404 in the image and nowhere else.
COPY public ./public

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
