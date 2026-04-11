FROM node:20-alpine

# Build tools for native modules (better-sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm ci || npm install

COPY dashboard/ .

RUN npm run build

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "start"]
