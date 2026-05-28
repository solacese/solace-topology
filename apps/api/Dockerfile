FROM node:22-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @solace-topology/shared && npm run build -w @solace-topology/api

FROM node:22-alpine
WORKDIR /workspace
ENV NODE_ENV=production
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install --omit=dev --workspaces --include-workspace-root=false
COPY --from=build /workspace/packages/shared/dist packages/shared/dist
COPY --from=build /workspace/apps/api/dist apps/api/dist
EXPOSE 8080
CMD ["node", "apps/api/dist/index.js"]
