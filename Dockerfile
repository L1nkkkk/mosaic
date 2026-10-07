FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1 AS base
WORKDIR /app

FROM base AS test
COPY package.json ./
COPY server ./server
COPY web ./web
COPY modules ./modules
COPY scripts ./scripts
COPY test ./test
RUN npm test && npm run check

FROM base AS runtime
ARG GIT_SHA=development
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data GIT_SHA=${GIT_SHA}
LABEL org.opencontainers.image.title="Mosaic" \
      org.opencontainers.image.source="https://github.com/L1nkkkk/mosaic" \
      org.opencontainers.image.revision=${GIT_SHA}
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node web ./web
COPY --chown=node:node modules ./modules
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000'+(process.env.BASE_PATH||'')+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
