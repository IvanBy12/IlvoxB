FROM node:22-bookworm-slim AS build

ARG NPM_VERSION=11.17.0
RUN npm install -g npm@${NPM_VERSION}

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci

COPY tsconfig.json tsconfig.build.json ./

COPY src ./src

RUN npm run build


FROM node:22-bookworm-slim AS production

ARG NPM_VERSION=11.17.0
RUN npm install -g npm@${NPM_VERSION}

ENV NODE_ENV=production

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

EXPOSE 3001

USER node

CMD ["node", "dist/server.js"]