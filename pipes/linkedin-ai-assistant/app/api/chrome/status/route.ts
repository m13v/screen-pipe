// import { NextResponse } from 'next/server';
// import { RouteLogger } from '@/lib/route-logger';
// import { ChromeSession } from '@/lib/chrome-session';

// export const runtime = 'nodejs';

// const logger = new RouteLogger('chrome-status');

// export async function GET() {
//   try {
//     logger.log('checking chrome connection status...');
    
//     // First check ChromeSession for stored URL
//     const session = ChromeSession.getInstance();
//     const storedUrl = session.getWsUrl();
//     logger.log(`stored url from session: ${storedUrl}`);
    
//     if (storedUrl) {
//       logger.log('using stored websocket url');
//       return NextResponse.json({
//         wsUrl: storedUrl,
//         status: 'connected',
//         logs: logger.getLogs()
//       });
//     }

//     // If no stored URL, check chrome connection
//     const response = await fetch('http://127.0.0.1:9222/json/version');
    
//     if (!response.ok) {
//       logger.log('chrome not connected');
//       return NextResponse.json({ 
//         status: 'not_connected',
//         logs: logger.getLogs()
//       }, { status: 200 });
//     }

//     const data = await response.json() as { webSocketDebuggerUrl: string };
//     logger.log('chrome connected, getting websocket url');
    
//     const wsUrl = data.webSocketDebuggerUrl.replace('ws://localhost:', 'ws://127.0.0.1:');
//     // Store the URL in ChromeSession
//     await session.setWsUrl(wsUrl);
//     logger.log(`websocket url: ${wsUrl}`);

//     return NextResponse.json({
//       wsUrl,
//       status: 'connected',
//       logs: logger.getLogs()
//     });
//   } catch (error) {
//     logger.error(`error checking status: ${error}`);
//     return NextResponse.json({ 
//       status: 'not_connected',
//       error: String(error),
//       logs: logger.getLogs()
//     }, { status: 200 });
//   }
// } 