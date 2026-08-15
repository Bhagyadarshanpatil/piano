"use client"
import { useEffect, useState } from 'react'
import { micInput } from './micInput'

export function useMicInput() {
  const [, setTick] = useState(0)
  
  useEffect(() => {
    return micInput.addListener(() => setTick((n) => n + 1))
  }, [])

  return {
    supported: micInput.isSupported(),
    isListening: micInput.isCurrentlyListening(),
    toggleListening: () => micInput.toggleListening(),
    startListening: () => micInput.start(),
    stopListening: () => micInput.stop(),
  }
}
