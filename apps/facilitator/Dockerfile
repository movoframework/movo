# Movo facilitator — build from the repository root:
#
#   docker build -t movo-facilitator -f apps/facilitator/Dockerfile .
#
# Built from the root because the service is a workspace member: it depends on
# @movoframework/facilitator and @movoframework/core by `workspace:*`, and pnpm needs the
# lockfile and workspace manifest to resolve them reproducibly.

# ─── Build ───────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /repo

RUN corepack enable

# Manifests first, so a source-only change reuses the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/facilitator/package.json packages/facilitator/
COPY apps/facilitator/package.json apps/facilitator/

# The root manifest lists every workspace package as a devDependency, and only three of them
# are copied here. `--ignore-workspace-root-check` is not enough on its own, so the install is
# scoped to the service and its transitive workspace deps.
#
# --frozen-lockfile: a container that silently resolved a different dependency tree than CI
# tested is a container running code nobody verified.
RUN pnpm install --frozen-lockfile --filter @movoframework/facilitator-service...

COPY packages/core packages/core
COPY packages/facilitator packages/facilitator
COPY apps/facilitator apps/facilitator

# Building the service's own tsconfig builds its project references — core, then facilitator,
# then the service — in dependency order. The root tsconfig is deliberately not used: it
# references packages this image does not contain.
RUN pnpm exec tsc --build apps/facilitator/tsconfig.json

# ─── Runtime ─────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /repo

RUN corepack enable

# Non-root. This process holds the sponsor keys; there is no reason for it to be able to write
# to its own image.
RUN addgroup -S movo && adduser -S movo -G movo

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/facilitator/package.json packages/facilitator/
COPY apps/facilitator/package.json apps/facilitator/

# A fresh production-only install rather than copying the build stage's node_modules: the
# build tree carries TypeScript and the whole toolchain, none of which should ship.
RUN pnpm install --frozen-lockfile --prod --filter @movoframework/facilitator-service...

COPY --from=build /repo/packages/core/dist packages/core/dist
COPY --from=build /repo/packages/facilitator/dist packages/facilitator/dist
COPY --from=build /repo/apps/facilitator/dist apps/facilitator/dist

RUN chown -R movo:movo /repo
USER movo

ENV NODE_ENV=production
ENV PORT=8402
EXPOSE 8402

# Liveness only. /ready reads sponsor balances from Horizon and is for the load balancer; using
# it here would restart a healthy container every time a sponsor needed topping up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8402)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/facilitator/dist/server.js"]
