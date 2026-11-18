#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
chmod 755 cmd/* 2>/dev/null || true
chmod 755 app/ui/*.cgi 2>/dev/null || true
FNPACK="${1:-./fnpack}"
chmod +x "$FNPACK" 2>/dev/null || true
"$FNPACK" build
ls -l ./*.fpk
