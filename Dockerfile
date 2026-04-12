FROM node:22-slim

# System dependencies
RUN apt-get update && apt-get install -y \
  tmux git python3 cmake build-essential curl \
  && rm -rf /var/lib/apt/lists/*

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"

# Install Claude Code + Context7
RUN npm install -g @anthropic-ai/claude-code @upstash/context7-mcp

# Create workspace
RUN mkdir -p /root/workspace/skills/custom /root/workspace/memory

# Copy Sento CLI
COPY bin/ /opt/sento/bin/
COPY src/ /opt/sento/src/
COPY package.json /opt/sento/
RUN cd /opt/sento && npm install --production

# Entrypoint script
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

WORKDIR /root/workspace
EXPOSE 9876

ENTRYPOINT ["/docker-entrypoint.sh"]
