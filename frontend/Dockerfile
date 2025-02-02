FROM node:23.7.0

WORKDIR /usr/src/app

COPY package.json ./
RUN npm install && mv node_modules ../

CMD ["npm", "run", "dev"]
