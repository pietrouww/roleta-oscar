FROM node:22-alpine
ENV NODE_ENV=production
# ffmpeg converte os áudios do WhatsApp (ogg/opus) para um formato que toca no iPhone
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
COPY public ./public
ENV DATA_DIR=/data PORT=3100
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3100
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://127.0.0.1:3100/health || exit 1
CMD ["node", "src/server.js"]
