FROM node:24-alpine
WORKDIR /app
COPY team-server.mjs ./
RUN mkdir /data && chown node:node /data
USER node
ENV JUNO_DATA_DIR=/data HOST=0.0.0.0 PORT=8787
VOLUME /data
EXPOSE 8787
CMD ["node", "team-server.mjs"]
