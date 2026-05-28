FROM node:22-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install

FROM deps AS build
ARG VITE_API_BASE_URL=http://localhost:8080
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @solace-topology/shared && npm run build -w @solace-topology/web

FROM node:22-alpine
WORKDIR /workspace
RUN npm install -g vite@6.3.5
COPY --from=build /workspace/apps/web/dist apps/web/dist
EXPOSE 3000
CMD ["vite", "preview", "--host", "0.0.0.0", "--port", "3000", "--outDir", "apps/web/dist"]
