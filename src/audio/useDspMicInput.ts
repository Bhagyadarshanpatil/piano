"use client"
import { useEffect, useState } from 'react'
import { dspMicInput } from './dspMicInput'

export function useDspMicInput() {
  const [, setTick] = useState(0)

  useEffect(() => {
    return dspMicInput.addListener(() => setTick(n => n + 1))
  }, [])

  return {
    supported:       dspMicInput.isSupported(),
    isListening:     dspMicInput.isCurrentlyListening(),
    toggleListening: () => dspMicInput.toggleListening(),
    startListening:  () => dspMicInput.start(),
    stopListening:   () => dspMicInput.stop(),
  }
}
