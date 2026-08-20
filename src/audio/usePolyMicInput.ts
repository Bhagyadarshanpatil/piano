"use client"
import { useEffect, useState } from 'react'
import { polyMicInput } from './polyMicInput'

export function usePolyMicInput() {
  const [, setTick] = useState(0)
  
  useEffect(() => {
    return polyMicInput.addListener(() => setTick((n) => n + 1))
  }, [])

  return {
    supported: polyMicInput.isSupported(),
    isListening: polyMicInput.isCurrentlyListening(),
    toggleListening: () => polyMicInput.toggleListening(),
    startListening: () => polyMicInput.start(),
    stopListening: () => polyMicInput.stop(),
  }
}
