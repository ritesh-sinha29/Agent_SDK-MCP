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
  const [currentSubtitle, setCurrentSubtitle] = useState<string | null>(null)
  
  const audioContextRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  
  // Audio Queue logic (now stores { audio, text })
  const queueRef = useRef<{ audio: string; text: string }[]>([])
  const isCurrentlyPlayingRef = useRef(false)

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

  const startVisualizer = useCallback(() => {
    if (!analyserRef.current) return
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
    
    const updateVolume = () => {
      if (!analyserRef.current) return
      analyserRef.current.getByteFrequencyData(dataArray)
      
      let sum = 0
      for(let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i]
      }
      const average = sum / dataArray.length
      setVolume(Math.min(average / 100, 1)) 
      
      animationFrameRef.current = requestAnimationFrame(updateVolume)
    }
    updateVolume()
  }, [])

  const playRawAudio = useCallback(async (base64Audio: string, text: string) => {
    initAudioContext()
    if (!audioContextRef.current || !analyserRef.current) return

    try {
      const binaryString = window.atob(base64Audio)
      const len = binaryString.length
      const bytes = new Uint8Array(len)
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      const audioBuffer = await audioContextRef.current.decodeAudioData(bytes.buffer)

      if (sourceRef.current) {
        try { sourceRef.current.stop() } catch (e) {}
      }

      sourceRef.current = audioContextRef.current.createBufferSource()
      sourceRef.current.buffer = audioBuffer
      sourceRef.current.connect(analyserRef.current)
      
      setCurrentSubtitle(text)
      
      sourceRef.current.onended = () => {
        sourceRef.current = null
        // Check queue for next chunk
        if (queueRef.current.length > 0) {
            const next = queueRef.current.shift()!
            playRawAudio(next.audio, next.text)
        } else {
            isCurrentlyPlayingRef.current = false
            setIsPlaying(false)
            setCurrentSubtitle(null)
            if (animationFrameRef.current) {
                cancelAnimationFrame(animationFrameRef.current)
                animationFrameRef.current = null
            }
            setVolume(0)
        }
      }

      sourceRef.current.start(0)
      isCurrentlyPlayingRef.current = true
      setIsPlaying(true)
      
      if (!animationFrameRef.current) {
          startVisualizer()
      }

    } catch (error) {
      console.error("Error playing audio chunk:", error)
      isCurrentlyPlayingRef.current = false
      setIsPlaying(false)
      setCurrentSubtitle(null)
    }
  }, [initAudioContext, startVisualizer])

  const enqueueAudio = useCallback((base64Audio: string, text: string = "") => {
      if (isCurrentlyPlayingRef.current) {
          queueRef.current.push({ audio: base64Audio, text })
      } else {
          playRawAudio(base64Audio, text)
      }
  }, [playRawAudio])

  const stopAudio = useCallback(() => {
    queueRef.current = []
    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch (e) {}
      sourceRef.current = null
    }
    isCurrentlyPlayingRef.current = false
    setIsPlaying(false)
    setCurrentSubtitle(null)
    setVolume(0)
    if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
    }
  }, [])

  return {
    isPlaying,
    playAudio: enqueueAudio,
    enqueueAudio,
    stopAudio,
    volume,
    currentSubtitle
  }
}
