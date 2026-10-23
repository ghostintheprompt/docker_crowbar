FROM node:20-slim
WORKDIR /srv
# server.js and the shared decide.js sit side by side so require("./decide") resolves.
COPY app/server.js ./server.js
COPY lib/decide.js ./decide.js
# Run as the image's built-in non-root user. The lab preaches Docker hygiene;
# it should not ship containers running as root.
USER node
CMD ["node", "server.js"]
