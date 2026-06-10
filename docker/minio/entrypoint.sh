#!/bin/sh
# 后台启动 minio(不用 nohup,直接 & 拿 $! 就是 minio 的 PID)
/usr/bin/minio server /data --console-address ":9001" > /var/log/minio.log 2>&1 &
MINIO_PID=$!
echo "[entrypoint] minio PID = $MINIO_PID"

# 先把 mc alias 配上,后续 mc ready local 才能解析
mc alias set local http://127.0.0.1:9000 minioadmin minioadmin >/dev/null 2>&1 || true

# 等待 minio API 就绪(最多 60 秒)
i=0
while [ "$i" -lt 120 ]; do
  if /usr/bin/mc ready local >/dev/null 2>&1; then
    echo "[entrypoint] minio API ready after $i attempts"
    break
  fi
  i=$((i + 1))
  sleep 0.5
done

# 初始化:建桶 + 私有(全部 || true,允许重启)
mc mb -p local/qt-biz-attachments 2>/dev/null || true
mc anonymous set none local/qt-biz-attachments 2>/dev/null || true
echo "[entrypoint] MinIO ready: bucket qt-biz-attachments (private)"

# 等待 minio 退出(用 kill -0 轮询,比 wait 更稳健:不依赖父子关系)
while kill -0 "$MINIO_PID" 2>/dev/null; do
  sleep 1
done
echo "[entrypoint] minio exited"
exit 0
