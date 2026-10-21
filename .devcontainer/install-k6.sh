#!/usr/bin/env bash
# Installs k6 inside the Codespace / dev container (Debian), using the official k6 apt repository.
set -euo pipefail

if command -v k6 >/dev/null 2>&1; then
  echo "k6 is already installed: $(k6 version)"
  exit 0
fi

sudo apt-get update
sudo apt-get install -y gnupg ca-certificates curl
curl -fsSL https://dl.k6.io/key.gpg | sudo gpg --dearmor -o /usr/share/keyrings/k6-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" \
  | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update
sudo apt-get install -y k6
k6 version
