/**
 * Copyright (c) Microsoft Corporation.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { program } from 'commander';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';


import { createServer } from './index';
import { ServerList } from './server';

import type { LaunchOptions } from 'patchright';
import assert from 'assert';
import { ToolCapability } from './tools/tool';

const packageJSON = require('../package.json');

program
    .version('Version ' + packageJSON.version)
    .name(packageJSON.name)
    .option('--browser <browser>', 'Browser or chrome channel to use, possible values: chrome, firefox, webkit, msedge.')
    .option('--caps <caps>', 'Comma-separated list of capabilities to enable, possible values: tabs, pdf, history, wait, files, install. Default is all.')
    .option('--cdp-endpoint <endpoint>', 'CDP endpoint to connect to.')
    .option('--executable-path <path>', 'Path to the browser executable.')
    .option('--headless', 'Run browser in headless mode, headed by default')
    .option('--port <port>', 'Port to listen on for SSE transport.')
    .option('--user-data-dir <path>', 'Path to the user data directory')
    .option('--vision', 'Run server that uses screenshots (Aria snapshots are used by default)')
    .action(async options => {
      let browserName: 'chromium' | 'firefox' | 'webkit';
      let channel: string | undefined;
      switch (options.browser) {
        case 'chrome':
        case 'chrome-beta':
        case 'chrome-canary':
        case 'chrome-dev':
        case 'msedge':
        case 'msedge-beta':
        case 'msedge-canary':
        case 'msedge-dev':
          browserName = 'chromium';
          channel = options.browser;
          break;
        case 'chromium':
          browserName = 'chromium';
          break;
        case 'firefox':
          browserName = 'firefox';
          break;
        case 'webkit':
          browserName = 'webkit';
          break;
        default:
          browserName = 'chromium';
          channel = 'chrome';
      }

      const launchOptions: LaunchOptions = {
        headless: !!(options.headless ?? (os.platform() === 'linux' && !process.env.DISPLAY)),
        channel,
        executablePath: options.executablePath,
      };

      const userDataDir = options.userDataDir ?? await createUserDataDir(browserName);

      const serverList = new ServerList(() => createServer({
        browserName,
        userDataDir,
        launchOptions,
        vision: !!options.vision,
        cdpEndpoint: options.cdpEndpoint,
        capabilities: options.caps?.split(',').map((c: string) => c.trim() as ToolCapability),
      }));
      setupExitWatchdog(serverList);

      if (options.port) {
        startSSEServer(+options.port, serverList);
      } else {
        const server = await serverList.create();
        await server.connect(new StdioServerTransport());
      }
    });

function setupExitWatchdog(serverList: ServerList) {
  const handleExit = async () => {
    setTimeout(() => process.exit(0), 15000);
    await serverList.closeAll();
    process.exit(0);
  };

  process.stdin.on('close', handleExit);
  process.on('SIGINT', handleExit);
  process.on('SIGTERM', handleExit);
}

program.parse(process.argv);

async function createUserDataDir(browserName: 'chromium' | 'firefox' | 'webkit') {
  let cacheDirectory: string;
  if (process.platform === 'linux')
    cacheDirectory = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  else if (process.platform === 'darwin')
    cacheDirectory = path.join(os.homedir(), 'Library', 'Caches');
  else if (process.platform === 'win32')
    cacheDirectory = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  else
    throw new Error('Unsupported platform: ' + process.platform);
  const result = path.join(cacheDirectory, 'ms-playwright', `mcp-${browserName}-profile`);
  await fs.promises.mkdir(result, { recursive: true });
  return result;
}

async function startSSEServer(port: number, serverList: ServerList) {
  const sessions = new Map<string, SSEServerTransport>();
  const httpServer = http.createServer(async (req, res) => {
    if (req.method === 'POST') {
      const searchParams = new URL(`http://localhost${req.url}`).searchParams;
      const sessionId = searchParams.get('sessionId');
      if (!sessionId) {
        res.statusCode = 400;
        res.end('Missing sessionId');
        return;
      }
      const transport = sessions.get(sessionId);
      if (!transport) {
        res.statusCode = 404;
        res.end('Session not found');
        return;
      }

      await transport.handlePostMessage(req, res);
      return;
    } else if (req.method === 'GET') {
      const transport = new SSEServerTransport('/sse', res);
      sessions.set(transport.sessionId, transport);
      const server = await serverList.create();
      res.on('close', () => {
        sessions.delete(transport.sessionId);
        serverList.close(server).catch(e => console.error(e));
      });
      await server.connect(transport);
      return;
    } else {
      res.statusCode = 405;
      res.end('Method not allowed');
    }
  });

  httpServer.listen(port, () => {
    const address = httpServer.address();
    assert(address, 'Could not bind server socket');
    let url: string;
    if (typeof address === 'string') {
      url = address;
    } else {
      const resolvedPort = address.port;
      let resolvedHost = address.family === 'IPv4' ? address.address : `[${address.address}]`;
      if (resolvedHost === '0.0.0.0' || resolvedHost === '[::]')
        resolvedHost = 'localhost';
      url = `http://${resolvedHost}:${resolvedPort}`;
    }
    console.log(`Listening on ${url}`);
    console.log('Put this in your client config:');
    console.log(JSON.stringify({
      'mcpServers': {
        'playwright': {
          'url': `${url}/sse`
        }
      }
    }, undefined, 2));
  });
}
