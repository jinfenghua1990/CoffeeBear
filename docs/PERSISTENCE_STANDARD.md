# 持久化与数据分离标准

## 原则

应用代码是可替换的，业务数据是持久化的。更新、回滚、重新克隆仓库都不能依赖代码目录中的业务数据才能恢复。

持久化对象包括：

- PostgreSQL：核心业务数据；
- DATA_DIR：发票、物流账单、Excel、商品附件、导入原件、系统更新状态等；
- Redis：缓存与任务状态；重要业务真相不能只存在 Redis；
- BACKUP_DIR：数据库与文件备份；
- LOG_DIR：运行日志。

## 推荐目录

原生部署建议：

```text
/Users/<user>/ecommerce-workspace/          # 代码，可替换
/Users/<user>/ecommerce-workspace-data/
  production/
    data/
    backups/
    logs/
  staging/
    data/
    backups/
    logs/
```

正式环境与测试环境不得共用 data、backup、log，也不得共用数据库。

## Production 硬门禁

当 `APP_ENV=production` 时：

- `PERSIST_ROOT` 必须显式配置；
- `PERSIST_ROOT`、`DATA_DIR`、`BACKUP_DIR`、`LOG_DIR` 均不得位于 Git 代码目录内；
- `DATABASE_URL` 必须指向独立 PostgreSQL，而不是 SQLite / 代码目录内文件数据库；
- 更新中心环境自检发现上述任一问题时，必须阻止系统升级；
- detached update runner 在真正切换 Git 版本前再次执行持久化目录校验，不能只依赖 UI/API 门禁。

因此，正常目标状态是：整个 `ecommerce-workspace` 代码目录都可以删除并重新 clone，只要 PostgreSQL、持久化目录与部署密钥仍在，业务数据就不丢失。

## 兼容迁移

运行层仍保留旧目录回退逻辑，便于历史实例读取和迁移；但 production 在完成数据外置前不得继续执行系统升级，标准化不能直接移动真实数据。

迁移时必须：

1. 停止 API / worker / beat；
2. 生成数据库与 data 全量备份；
3. 校验备份；
4. 将旧 data 复制到新的持久化目录；
5. 在 .env 配置 PERSIST_ROOT / DATA_DIR / BACKUP_DIR / LOG_DIR；
6. 启动服务并核对文件、订单、库存、财务数据；
7. 确认无误后再清理旧目录。

任何自动更新不得自行移动或删除真实业务数据。
