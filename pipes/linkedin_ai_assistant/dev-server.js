#!/usr/bin/env node

const { spawn } = require('child_process');
const { existsSync } = require('fs');
const path = require('path');
const open = require('open');

async function installBun() {
  console.log('installing bun...');
  const isWindows = process.platform === 'win32';
  
  if (isWindows) {
    await spawn('powershell', ['-Command', 'iwr bun.sh/install.ps1|iex'], { 
      stdio: 'inherit',
      shell: true 
    });
  } else {
    await spawn('curl', ['-fsSL', 'https://bun.sh/install'], { 
      stdio: 'inherit',
      shell: true 
    });
  }
}

async function main() {
  const cwd = process.cwd();
  
  // Check if bun is installed
  try {
    spawn('bun', ['--version']);
  } catch {
    await installBun();
  }

  // Install dependencies if needed
  if (!existsSync(path.join(cwd, 'node_modules'))) {
    console.log('installing dependencies...');
    await new Promise((resolve) => {
      const install = spawn('bun', ['install'], { 
        stdio: 'inherit',
        shell: true 
      });
      install.on('close', resolve);
    });
  }

  // Start dev server
  console.log('starting development server...');
  const dev = spawn('bun', ['dev'], { 
    stdio: 'inherit',
    shell: true 
  });

  // Open browser after a short delay
  setTimeout(() => {
    open('http://localhost:3000');
  }, 2000);

  // Handle cleanup
  process.on('SIGINT', () => {
    dev.kill();
    process.exit();
  });
}

main().catch(console.error);