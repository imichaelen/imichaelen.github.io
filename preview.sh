#!/bin/bash
# Simple local preview server for the website

PORT=${1:-8000}

echo "🚀 Starting local preview server..."
echo "📁 Serving from: $(pwd)"
echo "🌐 Main site: http://localhost:$PORT/"
echo "🎨 Demo site: http://localhost:$PORT/docs/"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

python3 -m http.server $PORT
