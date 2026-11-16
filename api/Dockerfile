FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# copy package files first so Docker caches the install step
COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

EXPOSE 4000
USER node

HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/api/v1/health || exit 1

CMD ["node", "src/server.js"]