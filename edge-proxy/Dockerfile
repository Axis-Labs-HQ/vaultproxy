FROM node:20-alpine

WORKDIR /app

COPY edge-proxy/package.json ./
RUN npm install --production

COPY edge-proxy/ .

EXPOSE 3001

CMD ["npx", "tsx", "src/node.ts"]
