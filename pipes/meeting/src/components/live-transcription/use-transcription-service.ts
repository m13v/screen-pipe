import { useRecentChunks } from './hooks/pull-meetings-from-screenpipe'
import { useTranscriptionStream } from './hooks/screenpipe-stream-transcription-api'
import { useBrowserTranscriptionStream } from './hooks/browser-stream-transcription-api'
import { useEffect, useRef } from 'react'
import { getLiveMeetingData } from './hooks/storage-for-live-meeting'
import { usePostHog } from 'posthog-js/react'
import { useAudioHealth } from '@/lib/hooks/use-audio-health'

export function useTranscriptionService() {
  const { chunks, setChunks, isLoading, fetchRecentChunks } = useRecentChunks()
  const { startTranscriptionScreenpipe, stopTranscriptionScreenpipe } = useTranscriptionStream(setChunks)
  const { startTranscriptionBrowser, stopTranscriptionBrowser } = useBrowserTranscriptionStream(setChunks)
  const initRef = useRef(false)
  const modeRef = useRef<'browser' | 'screenpipe' | null>(null)
  const posthog = usePostHog()
  const { isHealthy } = useAudioHealth()

  // Load stored chunks only once
  useEffect(() => {
    const loadStoredChunks = async () => {
      if (initRef.current) return
      initRef.current = true
      
      console.log('transcription-service: initializing')
      const storedData = await getLiveMeetingData()
      if (storedData?.chunks) {
        console.log('transcription-service: loaded stored chunks:', {
          count: storedData.chunks.length,
          firstChunk: storedData.chunks[0]?.text?.slice(0, 50),
          lastChunk: storedData.chunks[storedData.chunks.length - 1]?.text?.slice(0, 50)
        })
        setChunks(storedData.chunks)
      } else {
        console.log('transcription-service: no stored chunks found')
      }
    }
    loadStoredChunks()
  }, [setChunks])

  // Handle transcription mode based on audio health
  useEffect(() => {
    console.log('transcription-service: health status changed:', { 
      isHealthy, 
      currentMode: modeRef.current,
      isInitialized: initRef.current 
    })

    const mode = isHealthy ? 'screenpipe' : 'browser'

    // First mount or mode change
    if (modeRef.current !== mode) {
      console.log('transcription-service: switching mode', {
        from: modeRef.current || 'initial',
        to: mode,
        reason: isHealthy ? 'audio_healthy' : 'audio_unhealthy'
      })
      
      // Track mode change in PostHog
      posthog.capture('meeting_web_app_transcription_mode_changed', {
        from: modeRef.current || 'initial',
        to: mode,
        reason: isHealthy ? 'audio_healthy' : 'audio_unhealthy'
      })

      // Stop any existing transcription
      if (modeRef.current) {
        console.log('transcription-service: stopping current mode:', modeRef.current)
        if (modeRef.current === 'browser') {
          stopTranscriptionBrowser()
        } else {
          stopTranscriptionScreenpipe()
        }
      }
      
      // Update mode ref before starting new transcription
      modeRef.current = mode
      
      // Start new transcription based on health
      if (isHealthy) {
        console.log('transcription-service: starting screenpipe transcription')
        posthog.capture('meeting_web_app_transcription_started', { mode: 'screenpipe' })
        startTranscriptionScreenpipe()
      } else {
        console.log('transcription-service: starting browser transcription')
        posthog.capture('meeting_web_app_transcription_started', { mode: 'browser' })
        startTranscriptionBrowser()
      }
    } else {
      console.log('transcription-service: mode unchanged:', { mode, isHealthy })
    }

    // Cleanup function
    return () => {
      console.log('transcription-service: cleanup', { 
        mode: modeRef.current,
        isHealthy 
      })
      if (modeRef.current === 'browser') {
        stopTranscriptionBrowser()
      } else if (modeRef.current === 'screenpipe') {
        stopTranscriptionScreenpipe()
      }
      if (modeRef.current) {
        posthog.capture('meeting_web_app_transcription_stopped', { mode: modeRef.current })
      }
    }
  }, [isHealthy, startTranscriptionScreenpipe, stopTranscriptionScreenpipe, startTranscriptionBrowser, stopTranscriptionBrowser, posthog])

  return {
    chunks,
    isLoadingRecent: isLoading,
    fetchRecentChunks
  }
} 