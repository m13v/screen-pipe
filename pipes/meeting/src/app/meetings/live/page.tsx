'use client'

import { useRouter } from 'next/navigation'
import { LiveTranscription } from '@/components/live-transcription/new-meeting-wrapper'
import { useEffect, useRef } from 'react'

export default function LiveMeetingPage() {
  const router = useRouter()
  const mounted = useRef(false)
  
  useEffect(() => {
    if (mounted.current) return
    mounted.current = true
    
    console.log('live meeting page mounting, pathname:', window.location.pathname)
    
    return () => {
      console.log('live meeting page unmounting')
      mounted.current = false
    }
  }, [])
  
  return (
    <div className="h-full">
      <LiveTranscription />
    </div>
  )
}