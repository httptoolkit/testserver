FROM node:20-alpine

WORKDIR /usr/src/app

RUN mkdir /usr/src/app/cert_dir
ENV CERT_CACHE_DIR=/usr/src/app/cert_dir

COPY package.json package-lock.json ./

RUN npm ci --omit=dev

COPY src/ src/

CMD ["npm", "start"]