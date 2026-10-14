FROM node:24-bookworm-slim
WORKDIR /opt/juno-review
COPY server/review/ ./
RUN mkdir -p /var/lib/juno-review && chown -R node:node /var/lib/juno-review
USER node
ENV HOST=0.0.0.0 PORT=8788 JUNO_REVIEW_DATA=/var/lib/juno-review
EXPOSE 8788
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s CMD node -e "fetch('http://127.0.0.1:8788/health',{headers:{Host:new URL(process.env.JUNO_REVIEW_URL).host}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
