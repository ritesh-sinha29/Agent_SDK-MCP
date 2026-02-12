"use client"

import { useState, useRef, useCallback } from "react"

declare global {
  interface Window {
    webkitAudioContext: typeof AudioContext;
  }
}

export function useAudioPlayer() {
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(0) // 0-1 range for visualizer
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  const initAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)()
      analyserRef.current = audioContextRef.current.createAnalyser()
      analyserRef.current.fftSize = 256
      analyserRef.current.connect(audioContextRef.current.destination)
    }
    if (audioContextRef.current.state === "suspended") {
      audioContextRef.current.resume()
    }
  }, [])

  const playAudio = useCallback(async (base64Audio: string) => {
    initAudioContext()
    if (!audioContextRef.current || !analyserRef.current) return

    try {
      // Decode base64
      const binaryString = window.atob(base64Audio)
      const len = binaryString.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer)

      // Stop previous
      if (sourceRef.current) {
        sourceRef.current.stop()
      }

      // Create new source
      sourceRef.current = audioContextRef.current.createBufferSource()
      sourceRef.current.buffer = audioBuffer
      sourceRef.current.connect(analyserRef.current)
      
      sourceRef.current.onended = () => {
        setIsPlaying(false)
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current)
            animationFrameRef.current = null
        }
        setVolume(0)
      }

      sourceRef.current.start(0)
      setIsPlaying(true)

      // Visualize volume
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
      const updateVolume = () => {
        if (!analyserRef.current) return
        analyserRef.current.getByteFrequencyData(dataArray)
        
        // Calculate average volume
        let sum = 0
        for(let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i]
        }
        const average = sum / dataArray.length
        
        // Normalize 0-255 to 0-1, slightly boosted
        setVolume(Math.min(average / 100, 1)) 
        
        if (isPlaying) { // This closure captures old isPlaying state, but loop continues
           animationFrameRef.current = requestAnimationFrame(updateVolume)
        }
      }
      // Start loop
      updateVolume()

    } catch (error) {
      console.error("Error playing audio:", error)
      setIsPlaying(false)
    }
  }, [initAudioContext])

  const stopAudio = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.stop()
      sourceRef.current = null
    }
    setIsPlaying(false)
    setVolume(0)
    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
    }
  }, [])

  return {
    isPlaying,
    playAudio,
    stopAudio,
    volume
  }
}
