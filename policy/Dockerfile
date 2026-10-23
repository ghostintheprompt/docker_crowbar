FROM node:20-slim
WORKDIR /srv
COPY policy/server.js ./server.js
# Non-root, same reason as the app image.
USER node
CMD ["node", "server.js"]
