FROM node:22-alpine
WORKDIR /workspace
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --ignore-scripts
COPY scripts/live-broker-smoke.mjs scripts/live-broker-smoke.mjs
CMD ["node", "scripts/live-broker-smoke.mjs", "--traffic-only"]
