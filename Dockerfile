FROM node:24-alpine

WORKDIR /usr/src/app

RUN mkdir /usr/src/app/cert_dir
ENV CERT_CACHE_DIR=/usr/src/app/cert_dir

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY src/ src/

ARG GIT_HASH
ENV VERSION_HASH=${GIT_HASH}
ENV NODE_OPTIONS="--insecure-http-parser"
CMD ["npm", "start"]