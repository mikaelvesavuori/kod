#!/usr/bin/env node

/**
 * Minimal development server with live reload
 * No dependencies - uses only Node.js built-ins
 */

import { createServer } from 'http';
import { readFileSync, existsSync, statSync, watch } from 'fs';
import { join, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { spawn } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = process.env.PORT || 8000;
const WS_PORT = PORT + 1;
const DIST_DIR = join(__dirname, 'dist');
const SRC_DIR = join(__dirname, 'src');

// MIME types
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
  '.xml': 'application/xml'
};

// Live reload script injected into HTML
const LIVE_RELOAD_SCRIPT = `
<script>
(function() {
  const ws = new WebSocket('ws://localhost:${WS_PORT}');
  ws.onmessage = (event) => {
    if (event.data === 'reload') {
      console.log('🔄 Reloading page...');
      location.reload();
    }
  };
  ws.onopen = () => console.log('✅ Live reload connected');
  ws.onclose = () => {
    console.log('❌ Live reload disconnected - retrying...');
    setTimeout(() => location.reload(), 1000);
  };
})();
</script>
</body>
`;

// Build the site
function build() {
  return new Promise((resolve, reject) => {
    console.log('🔨 Building site...');
    const buildProcess = spawn('npm', ['run', 'build'], {
      stdio: 'inherit',
      shell: true
    });

    buildProcess.on('close', (code) => {
      if (code === 0) {
        console.log('✅ Build complete\n');
        resolve();
      } else {
        console.error('❌ Build failed\n');
        reject(new Error(`Build failed with code ${code}`));
      }
    });
  });
}

// HTTP Server
function startHttpServer() {
  const server = createServer((req, res) => {
    let filePath = req.url === '/' ? '/index.html' : req.url;

    // Remove query string
    filePath = filePath.split('?')[0];

    const fullPath = join(DIST_DIR, filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Check if file exists
    if (!existsSync(fullPath)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    // Check if it's a directory
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found');
      return;
    }

    try {
      // Handle video files with range requests
      if (ext === '.mp4' || ext === '.webm' || ext === '.ogg') {
        const range = req.headers.range;
        const fileSize = stats.size;

        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          const chunkSize = (end - start) + 1;
          const content = readFileSync(fullPath).slice(start, end + 1);

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': contentType,
          });
          res.end(content);
        } else {
          const content = readFileSync(fullPath);
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
          });
          res.end(content);
        }
        return;
      }

      // Regular file handling
      let content = readFileSync(fullPath);

      // Inject live reload script into HTML files
      if (ext === '.html') {
        content = content.toString().replace('</body>', LIVE_RELOAD_SCRIPT);
      }

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content);
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 Internal Server Error');
      console.error('Error serving file:', error);
    }
  });

  server.listen(PORT, () => {
    console.log(`🚀 Dev server running at http://localhost:${PORT}`);
    console.log(`📁 Serving from: ${DIST_DIR}`);
    console.log(`👀 Watching: ${SRC_DIR}\n`);
  });

  return server;
}

// WebSocket Server for live reload
function startWebSocketServer() {
  const wss = new WebSocketServer({ port: WS_PORT });

  wss.on('connection', (ws) => {
    console.log('🔌 Browser connected');
  });

  return wss;
}

// File watcher
let buildTimeout = null;
let isBuilding = false;

function startFileWatcher(wss) {
  const watchDirs = [
    join(SRC_DIR),
  ];

  watchDirs.forEach(dir => {
    watch(dir, { recursive: true }, async (eventType, filename) => {
      if (!filename) return;

      // Ignore certain files/directories
      if (filename.includes('.DS_Store') ||
          filename.includes('node_modules') ||
          filename.includes('.git')) {
        return;
      }

      console.log(`📝 Changed: ${filename}`);

      // Debounce builds
      clearTimeout(buildTimeout);
      buildTimeout = setTimeout(async () => {
        if (isBuilding) return;

        isBuilding = true;
        try {
          await build();

          // Notify all connected clients to reload
          wss.clients.forEach((client) => {
            if (client.readyState === 1) { // WebSocket.OPEN
              client.send('reload');
            }
          });
        } catch (error) {
          console.error('Build error:', error);
        } finally {
          isBuilding = false;
        }
      }, 300);
    });
  });
}

// Main
async function main() {
  console.log('🎨 Kod Dev Server\n');

  // Initial build
  try {
    await build();
  } catch (error) {
    console.error('Initial build failed:', error);
    process.exit(1);
  }

  // Start servers
  const httpServer = startHttpServer();
  const wss = startWebSocketServer();

  // Start file watcher
  startFileWatcher(wss);

  console.log('💡 Ready! Make changes to files in src/ and see them live.\n');

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n👋 Shutting down...');
    httpServer.close();
    wss.close();
    process.exit(0);
  });
}

main().catch(console.error);
