import { useRef, useCallback } from 'react'
import { pipe } from "@screenpipe/browser"
import { useToast } from "@/hooks/use-toast"
import { TranscriptionChunk, ServiceStatus } from '../../meeting-history/types'

declare global {
  interface Window {
    _eventSource?: EventSource;
  }
}

export function useTranscriptionStream(
  setChunks: (updater: (prev: TranscriptionChunk[]) => TranscriptionChunk[]) => void
) {
  const streamingRef = useRef(false)
  const { toast } = useToast()

  const stopTranscriptionScreenpipe = useCallback(() => {
    if (window._eventSource) {
      console.log('stopping screenpipe transcription')
      window._eventSource.close()
      window._eventSource = undefined
      streamingRef.current = false
    }
  }, [])

  const startTranscriptionScreenpipe = useCallback(async () => {
    if (streamingRef.current) {
      console.log('transcription already streaming')
      return
    }

    try {
      console.log('starting transcription stream...')
      streamingRef.current = true

      console.log('attempting to get stream from pipe.streamTranscriptions()')
      const stream = pipe.streamTranscriptions()
      console.log('got stream object:', stream)

      for await (const chunk of stream) {
        // Log raw chunk first
        console.log('raw chunk received:', JSON.stringify(chunk, null, 2))
        
        // Then log specific properties we care about
        console.log('chunk details:', {
          id: chunk.id,
          object: chunk.object,
          created: chunk.created,
          model: chunk.model,
          choiceText: chunk?.choices?.[0]?.text,
          finishReason: chunk?.choices?.[0]?.finish_reason,
          metadata: chunk.metadata,
        })

        setChunks(prev => [...prev, {
          text: chunk.choices[0].text,
          timestamp: new Date().toISOString(),
          isInput: chunk.metadata?.isInput ?? false,
          device: chunk.metadata?.device ?? 'unknown',
          id: Date.now()
        }])
      }
    } catch (error) {
      console.error('transcription stream error:', {
        error,
        message: error instanceof Error ? error.message : 'unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        phase: streamingRef.current ? 'during-stream' : 'stream-setup'
      })
      
      streamingRef.current = false
      toast({
        title: "transcription error",
        description: "please enable realtime audio transcription in account -> settings -> recording",
        variant: "destructive",
      })
    }
  }, [toast, setChunks])

  return { 
    startTranscriptionScreenpipe, 
    stopTranscriptionScreenpipe, 
    isStreaming: streamingRef.current 
  }
} 