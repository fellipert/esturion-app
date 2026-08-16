FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public
COPY migrations ./migrations

RUN mkdir -p uploads

EXPOSE 4000

CMD ["node", "server/index.js"]

cd ~/Downloads
ls esturion-app

