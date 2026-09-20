# 圆筒包装接缝避让 Web 应用
FROM node:20-alpine

WORKDIR /app

# 仅先拷贝清单以利用层缓存
COPY package.json package-lock.json* ./

# 依赖安装（构建/启动初始化的一部分）
RUN npm install --omit=dev

# 拷贝应用源码
COPY server.js ./
COPY lib ./lib
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# 容器启动即完成依赖就绪后的服务初始化
CMD ["node", "server.js"]
