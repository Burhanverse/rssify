#!/bin/bash

# Check if running in Docker/Pterodactyl container
IS_CONTAINER=false
if [ -f "/.dockerenv" ] || [ -n "$P_SERVER_UUID" ] || [ -n "$PTERODACTYL" ] || grep -q "docker\|lxc\|pterodactyl" /proc/1/cgroup 2>/dev/null; then
    IS_CONTAINER=true
fi

VENV_DIR="api/venv"

# Auto-detect mode
if [ "$IS_CONTAINER" = true ]; then
  echo "🐳 Container environment detected"
  
  # If in Pterodactyl, force Python 3.12, otherwise auto-detect
  if [ -n "$P_SERVER_UUID" ] || [ -n "$PTERODACTYL" ]; then
    echo "🦖 Using Python 3.12 for Pterodactyl"
    PYTHON_BIN="python3.12"
    PIP_BIN="pip3.12"
  else
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
else
  echo "💻 Local environment detected - using venv"
  
  # Detect Python for venv creation
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
  
  # Create virtual environment if it doesn't exist
  if [ ! -d "$VENV_DIR" ]; then
      echo "📦 Creating virtual environment..."
      $PYTHON_BIN -m venv "$VENV_DIR" || {
          echo "❌ Failed to create virtual environment."
          exit 1
      }
      echo "✅ Virtual environment created"
  fi
  
  # Use venv's Python and pip
  PYTHON_BIN="$VENV_DIR/bin/python"
  PIP_BIN="$VENV_DIR/bin/pip"
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
