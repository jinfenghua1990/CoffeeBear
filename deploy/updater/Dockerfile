FROM docker:27-cli
RUN apk add --no-cache python3 bash curl tar git docker-cli-compose
WORKDIR /app
COPY deploy/updater/agent.py /app/agent.py
COPY deploy/updater/update-job.sh /app/update-job.sh
RUN chmod 755 /app/agent.py /app/update-job.sh
EXPOSE 8765
CMD ["python3", "/app/agent.py"]
