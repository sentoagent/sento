FROM node:22-slim

# System dependencies
RUN apt-get update && apt-get install -y \
  tmux git python3 cmake build-essential curl unzip sudo cron \
  && rm -rf /var/lib/apt/lists/*

# Create non-root user (Claude Code refuses --dangerously-skip-permissions as root)
RUN useradd -m -s /bin/bash sento \
  && echo "sento ALL=(root) NOPASSWD: /usr/sbin/cron" >> /etc/sudoers.d/sento
ENV HOME=/home/sento

# Install Bun as sento user
USER sento
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/sento/.bun/bin:${PATH}"

# Install Claude Code + Context7 to user prefix
RUN mkdir -p /home/sento/.npm-global \
  && npm config set prefix /home/sento/.npm-global \
  && npm install -g --prefix /home/sento/.npm-global @anthropic-ai/claude-code @upstash/context7-mcp
ENV PATH="/home/sento/.npm-global/bin:${PATH}"

# Create workspace
RUN mkdir -p /home/sento/workspace/skills/custom /home/sento/workspace/memory

# Copy Sento CLI (as root, then fix perms)
USER root
COPY bin/ /opt/sento/bin/
COPY src/ /opt/sento/src/
COPY package.json /opt/sento/
RUN cd /opt/sento && npm install --production

# Entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

USER sento
WORKDIR /home/sento/workspace
EXPOSE 9876

ENTRYPOINT ["/docker-entrypoint.sh"]
