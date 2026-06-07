# Portable Moltbit image — one Node process serving the SPA + all /api routes.
# Deploy to Fly.io / Render / Railway / any VPS. No Vercel function/cron limits.
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json .npmrc* ./
RUN npm install
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json .npmrc* ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY api ./api
COPY lib ./lib
COPY server.js ./
EXPOSE 3000
CMD ["node", "server.js"]
