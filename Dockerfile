FROM node:24-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY src/ src/

ARG GIT_HASH
ENV VERSION_HASH=${GIT_HASH}
ENV NODE_OPTIONS="--insecure-http-parser"

EXPOSE 53/udp

CMD ["npm", "start"]