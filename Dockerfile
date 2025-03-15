# 使用官方的Ubuntu镜像作为基础镜像
FROM ubuntu:22.04

# 设置环境变量以避免在构建过程中出现交互式提示
ENV DEBIAN_FRONTEND=noninteractive

# 安装Xvfb和Chromium所需的软件包
RUN apt-get update && \
    apt-get install -y \
        gnupg \
        ca-certificates \
        libx11-xcb1 \
        libxcomposite1 \
        libxdamage1 \
        libxrandr2 \
        libxss1 \
        libxtst6 \
        libnss3 \
        libatk-bridge2.0-0 \
        libgtk-3-0 \
        x11-apps \
        fonts-liberation \
        libappindicator3-1 \
        libu2f-udev \
        libvulkan1 \
        libdrm2 \
        xdg-utils \
        xvfb \
        libasound2 \
        libcurl4 \
        libgbm1 \
        software-properties-common \
    && add-apt-repository -y ppa:xtradeb/apps \
    && apt-get update \
    && apt-get install -y chromium \
    && rm -rf /var/lib/apt/lists/*

# 安装Node.js 22
RUN apt-get update && \
    apt-get install -y curl && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs

# 设置工作目录为 /app，所有后续操作都在这个目录下进行
WORKDIR /app

# 复制 package.json 和 package-lock.json 到工作目录，用于安装依赖
COPY package.json package-lock.json ./

# 运行 npm install 安装项目依赖
RUN npm install

# 复制项目的所有文件到工作目录
COPY . ./

# 添加调试命令，查看 /app/lib/ 目录的内容
RUN ls /app/lib/

# 暴露 3000 端口，因为 API 服务器默认监听此端口
EXPOSE 3000

# 复制并设置启动脚本
COPY docker_startup.sh /
RUN chmod +x /docker_startup.sh

# 直接设置入口点为启动脚本
ENTRYPOINT ["bash", "-c", ". /docker_startup.sh && exec bash"]
