FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server ./server
COPY public ./public
# persistent player/highscore/map data lives in /app/data — mount a volume there
RUN mkdir -p data
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "server/server.js"]
