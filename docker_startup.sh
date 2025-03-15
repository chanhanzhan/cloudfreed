#!/bin/bash

# 函数：查找可用的 DISPLAY
find_free_display() {
    local display_num=1
    while true; do
        local lock_file="/tmp/.X${display_num}-lock"
        local socket_file="/tmp/.X11-unix/X${display_num}"
        if [ ! -e "$lock_file" ] && [ ! -e "$socket_file" ]; then
            echo ":${display_num}"
            return
        fi
        display_num=$((display_num + 1))
    done
}

# 自动获取可用的 DISPLAY
DISPLAY=$(find_free_display)
echo "使用 DISPLAY=${DISPLAY}"

# 定义锁文件路径
LOCK_FILE="/tmp/.X${DISPLAY#:}-lock"

echo "检查现有的 Xvfb 进程和锁文件..."

# 检查并清理可能的残留锁文件和进程
if [ -f "$LOCK_FILE" ]; then
    PID=$(cat "$LOCK_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "发现运行中的 Xvfb 进程 (PID: $PID)，正在终止..."
        kill -15 "$PID"
        sleep 1
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "进程未终止，强制终止..."
            kill -9 "$PID"
        fi
    fi
    echo "删除锁文件 $LOCK_FILE..."
    rm -f "$LOCK_FILE"
fi

echo "启动 Xvfb..."
Xvfb "${DISPLAY}" -screen 0 1024x768x24 2>&1 | tee xvfb.log &
XVFB_PID=$!
sleep 2  # 等待 Xvfb 启动

# 检查 Xvfb 是否成功启动
if ! ps -p "$XVFB_PID" > /dev/null 2>&1; then
    echo "Xvfb 启动失败，请检查 xvfb.log"
    exit 1
else
    echo "Xvfb 成功启动，PID: $XVFB_PID"
fi

export DISPLAY=$DISPLAY
echo "设置 DISPLAY=${DISPLAY}"
echo "当前 DISPLAY$DISPLAY"

# 检查环境变量 CLIENT_KEY 是否设置
if [ -z "$CLIENT_KEY" ]; then
    echo "错误：环境变量 CLIENT_KEY 未设置。"
    exit 1
fi

echo "CLIENT_KEY: $CLIENT_KEY"  # 增加打印 CLIENT_KEY

# 设置 maxTasks 和 timeout，如果环境变量未设置则使用默认值
MAX_TASKS=${MAX_TASKS:-1}
TIMEOUT=${TIMEOUT:-30}

echo "CLIENT_KEY: $CLIENT_KEY"
echo "最大任务数(maxTasks): $MAX_TASKS"
echo "任务超时时间(timeout): $TIMEOUT 秒"

echo "启动服务器..."
node api.js -k "$CLIENT_KEY" -h 0.0.0.0 -m $MAX_TASKS -t $TIMEOUT
