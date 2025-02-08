'use client'

import { createContext, useContext, useEffect, useState } from 'react'

interface AudioHealthContext {
  isHealthy: boolean
  status: string
}

const AudioHealthContext = createContext<AudioHealthContext>({ isHealthy: false, status: 'loading' })

export function AudioHealthProvider({ children }: { children: React.ReactNode }) {
  const [health, setHealth] = useState<AudioHealthContext>({ isHealthy: false, status: 'loading' })

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/api/health')
        const data = await res.json()
        console.log('audio health check:', data)
        setHealth({ isHealthy: data.healthy, status: data.status })
      } catch (error) {
        console.error('audio health check failed:', error)
        setHealth({ isHealthy: false, status: 'error' })
      }
    }

    checkHealth()
    // Check health every 30 seconds
    const interval = setInterval(checkHealth, 30000)
    return () => clearInterval(interval)
  }, [])

  return (
    <AudioHealthContext.Provider value={health}>
      {children}
    </AudioHealthContext.Provider>
  )
}

export const useAudioHealth = () => useContext(AudioHealthContext) 