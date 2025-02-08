import { NextResponse } from 'next/server'

export async function GET() {
  try {
    const res = await fetch('http://127.0.0.1:3030/health')
    const data = await res.json()
    
    console.log('audio health check:', data.audio_status)

    return NextResponse.json({
      healthy: data.audio_status === 'ok',
      status: data.audio_status,
    })
  } catch (error) {
    console.error('audio health check failed:', error)
    return NextResponse.json({
      healthy: false,
      status: 'error',
    }, { status: 500 })
  }
} 