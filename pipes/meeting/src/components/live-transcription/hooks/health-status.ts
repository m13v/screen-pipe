import { useState } from 'react'
import { pipe } from "@screenpipe/browser"
import { ServiceStatus } from '../../meeting-history/types'

export function useServiceStatus() {
  const [serviceStatus, setServiceStatus] = useState<ServiceStatus>('unavailable')
  const [isChecking, setIsChecking] = useState(false)

  const checkService = async (startTranscription: () => Promise<void>) => {
    if (isChecking) {
      console.log('health-status: skipping check - already in progress')
      return
    }

    setIsChecking(true)
    console.log('health-status: starting service check')
    
    try {
      // Try to get first chunk from stream to verify service is working
      for await (const chunk of pipe.streamTranscriptions()) {
        console.log('health-status: received test chunk:', {
          chunk,
          choices: chunk.choices,
          metadata: chunk.metadata
        })
        
        if (chunk.error?.includes('invalid subscription') || 
            chunk.choices?.[0]?.text?.includes('invalid subscription')) {
          console.log('health-status: invalid subscription detected')
          setServiceStatus('no_subscription')
          throw new Error('invalid subscription')
        }
        
        console.log('health-status: service check successful')
        setServiceStatus('available')
        await startTranscription()
        break // Only need first chunk to verify
      }
    } catch (error) {
      console.error('health-status: service check failed:', {
        error,
        message: error instanceof Error ? error.message : 'unknown error',
        stack: error instanceof Error ? error.stack : undefined
      })
      setServiceStatus('unavailable')
    } finally {
      setIsChecking(false)
      console.log('health-status: check completed, status:', serviceStatus)
    }
  }

  const getStatusMessage = () => {
    switch (serviceStatus) {
      case 'no_subscription':
        return "please subscribe to screenpipe cloud in settings"
      case 'forbidden':
        return "please enable real-time transcription in screenpipe settings"
      case 'unavailable':
        return "waiting for screenpipe to be available..."
      default:
        return "transcribing..."
    }
  }

  return { serviceStatus, checkService, getStatusMessage }
} 