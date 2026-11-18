# 统一生产镜像：Next.js 仅负责静态构建，FastAPI 在 8000 同时托管 API + frontend/out。
FROM node:24-alpine AS frontend-builder
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && test -f out/index.html

FROM python:3.12-slim AS runtime
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TZ=Asia/Shanghai \
    FRONTEND_OUT=/app/frontend/out \
    DEPLOYMENT_MODE=container

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# GIT_SHA 必须声明在依赖安装之后。
# 它随每次提交变化；若出现在 pip install 之前，buildkit 会把 GIT_SHA
# 计入该 RUN 的缓存键（见 docker history 里的 `RUN |1 GIT_SHA=...`），
# 导致 424MB 依赖层每次构建都重建、每次发布都要重新下载约 128MB。
ARG GIT_SHA=""
ENV GIT_SHA=$GIT_SHA

COPY backend/ ./
COPY --from=frontend-builder /frontend/out /app/frontend/out

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
