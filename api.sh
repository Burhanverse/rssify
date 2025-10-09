#!/bin/bash

# Check if running in Pterodactyl container
IS_PTERODACTYL=false
if [ -f "/.dockerenv" ] && ([ -n "$P_SERVER_UUID" ] || [ -n "$PTERODACTYL" ] || grep -q "pterodactyl" /proc/1/cgroup 2>/dev/null); then
    IS_PTERODACTYL=true
fi

# Auto-detect mode
# If in Pterodactyl, force Python 3.12
if [ "$IS_PTERODACTYL" = true ]; then
  echo "🦖 Pterodactyl environment detected - using Python 3.12"
  PYTHON_BIN="python3.12"
  PIP_BIN="pip3.12"
else
  # Normal auto-detection
  # Detect Python
  if command -v python3 &>/dev/null; then
      PYTHON_BIN="python3"
  elif command -v python3.12 &>/dev/null; then
      PYTHON_BIN="python3.12"
  elif command -v python &>/dev/null; then
      PYTHON_BIN="python"
  else
      echo "❌ No suitable Python found (tried python3, python3.12, python)."
      exit 1
  fi

  # Detect Pip
  if command -v pip &>/dev/null; then
      PIP_BIN="pip"
  elif command -v pip3 &>/dev/null; then
      PIP_BIN="pip3"
  elif command -v pip3.12 &>/dev/null; then
      PIP_BIN="pip3.12"
  else
      echo "❌ No suitable pip found (tried pip, pip3, pip3.12)."
      exit 1
  fi
fi

echo "🐍 Using Python: $PYTHON_BIN"
echo "📦 Using Pip: $PIP_BIN"

# Install Python dependencies
$PIP_BIN install -r api/parserapi/requirements.txt || {
    echo "❌ Failed to install Python dependencies."
    exit 1
}

# Start ParserAPI
cd api || {
    echo "❌ Failed to navigate to api directory"
    exit 1
}

$PYTHON_BIN -m parserapi || {
    echo "❌ Failed to start API"
    exit 1
}
