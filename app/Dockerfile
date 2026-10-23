FROM node:20-slim
WORKDIR /srv
# server.js and the shared decide.js sit side by side so require("./decide") resolves.
COPY app/server.js ./server.js
COPY lib/decide.js ./decide.js
CMD ["node", "server.js"]
