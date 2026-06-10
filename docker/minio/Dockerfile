# 多阶段:从 minio/mc 抠出 mc 二进制,塞到 minio/minio 镜像里
# 目的:把原本 minio + minio-init 两个容器合并成一个,简化 docker-compose
FROM minio/mc:latest AS mc-source

FROM minio/minio:latest

# 拷入 mc 工具(供 entrypoint 建桶/初始化用)
COPY --from=mc-source /usr/bin/mc /usr/bin/mc

# 启动脚本:先在后台起 minio,等就绪后跑 mc 初始化,再 exec 把 minio 切回前台
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
