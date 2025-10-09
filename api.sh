#!/bin/bash

# Usage:
# ./run.sh --1  → Use python / pip
# ./run.sh --2  → Use python3 / pip3
# ./run.sh --3  → Use python3.12 / pip3.12
# ./run.sh      → Auto-detect

# Default: auto-detect mode
MODE="auto"

# Handle arguments
case "$1" in
  --1)
    PYTHON_BIN="python"
    PIP_BIN="pip"
    MODE="manual"
    ;;
  --2)
    PYTHON_BIN="python3"
    PIP_BIN="pip3"
    MODE="manual"
    ;;
  --3)
    PYTHON_BIN="python3.12"
    PIP_BIN="pip3.12"
    MODE="manual"
    ;;
esac

# Auto-detect mode
if [ "$MODE" = "auto" ]; then
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
echo "------------------------------------"

# Install Python dependencies
$PIP_BIN install -r api/parserapi/requirements.txt || {
    echo "❌ Failed to install Python dependencies."
    exit 1
}

# Start ParserAPI
$PYTHON_BIN -m parserapi || {
    echo "❌ Failed to start API"
    exit 1
}
