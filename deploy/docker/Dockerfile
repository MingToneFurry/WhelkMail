# WhelkMail on Docker (Node + built-in SQLite + optional S3/MinIO).
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:all

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S whelkmail && adduser -S whelkmail -G whelkmail \
    && mkdir -p /data && chown -R whelkmail:whelkmail /data /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/db ./db
COPY --from=build /app/package.json ./package.json
USER whelkmail
ENV HOST=0.0.0.0 \
    PORT=8787 \
    DB_PATH=/data/whelkmail.sqlite
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -qO- http://127.0.0.1:8787/api/health > /dev/null
CMD ["node", "dist-server/server.mjs"]
