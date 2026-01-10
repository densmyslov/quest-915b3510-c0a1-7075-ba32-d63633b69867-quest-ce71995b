'use client';

import { useCallback, useRef, useState } from 'react';

export type KnockSensitivity = 'low' | 'medium' | 'high';
export type KnockDetectionMode = 'accelerometer' | 'microphone' | 'both';

type KnockDetectorConfig = {
  requiredKnocks: number;
  maxIntervalMs: number;
  sensitivity: KnockSensitivity;
  detectionMode: KnockDetectionMode;
  onKnockDetected: (knockTimestamps: number[]) => void;
  onProgress?: (knockCount: number) => void;
};

type KnockDetectorState = {
  isListening: boolean;
  knockCount: number;
  knockTimestamps: number[];
  error: string | null;
};

const ACCELERATION_THRESHOLDS: Record<KnockSensitivity, number> = {
  low: 8,      // Was 25 (approx 0.8g)
  medium: 5,   // Was 15 (approx 0.5g)
  high: 2,     // Was 10 (approx 0.2g)
};

const AUDIO_THRESHOLDS: Record<KnockSensitivity, number> = {
  low: 0.7,
  medium: 0.5,
  high: 0.3,
};

export function useKnockDetector(config: KnockDetectorConfig) {
  const [state, setState] = useState<KnockDetectorState>({
    isListening: false,
    knockCount: 0,
    knockTimestamps: [],
    error: null,
  });

  const knockTimestampsRef = useRef<number[]>([]);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKnockTimeRef = useRef<number>(0);
  const cleanupFunctionsRef = useRef<(() => void)[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const DEBOUNCE_TIME = 100;

  const handleKnock = useCallback(
    (timestamp: number) => {
      if (timestamp - lastKnockTimeRef.current < DEBOUNCE_TIME) {
        return;
      }
      lastKnockTimeRef.current = timestamp;

      const newTimestamps = [...knockTimestampsRef.current, timestamp];
      knockTimestampsRef.current = newTimestamps;

      setState((prev) => ({
        ...prev,
        knockCount: newTimestamps.length,
        knockTimestamps: newTimestamps,
      }));

      config.onProgress?.(newTimestamps.length);

      if (newTimestamps.length >= config.requiredKnocks) {
        const firstKnock = newTimestamps[0];
        const lastKnock = newTimestamps[newTimestamps.length - 1];
        const totalTime = lastKnock - firstKnock;

        if (totalTime <= config.maxIntervalMs) {
          config.onKnockDetected(newTimestamps);
        } else {
          const recentKnocks = newTimestamps.filter((t) => timestamp - t <= config.maxIntervalMs);
          knockTimestampsRef.current = recentKnocks;
          setState((prev) => ({
            ...prev,
            knockCount: recentKnocks.length,
            knockTimestamps: recentKnocks,
          }));
        }
      }

      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => {
        if (knockTimestampsRef.current.length < config.requiredKnocks) {
          knockTimestampsRef.current = [];
          setState((prev) => ({ ...prev, knockCount: 0, knockTimestamps: [] }));
        }
      }, config.maxIntervalMs);
    },
    [config],
  );

  const startAccelerometer = useCallback(() => {
    if (typeof window === 'undefined') return;
    const threshold = ACCELERATION_THRESHOLDS[config.sensitivity];

    const handleMotion = (event: DeviceMotionEvent) => {
      // 1. Try to use gravity-compensated acceleration first (cleaner signal)
      if (event.acceleration && event.acceleration.x !== null) {
        const { x, y, z } = event.acceleration;
        if (x === null || y === null || z === null) return;
        const magnitude = Math.sqrt(x * x + y * y + z * z);
        if (magnitude > threshold) {
          handleKnock(Date.now());
        }
        return;
      }

      // 2. Fallback to acceleration including gravity
      const acc = event.accelerationIncludingGravity;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

      const magnitude = Math.sqrt(acc.x * acc.x + acc.y * acc.y + acc.z * acc.z);
      // Simple gravity removal approximation
      const delta = Math.abs(magnitude - 9.8);

      if (delta > threshold) {
        handleKnock(Date.now());
      }
    };

    if (typeof DeviceMotionEvent === 'undefined') {
      setState((prev) => ({ ...prev, error: 'Accelerometer not supported on this device' }));
      return;
    }

    const requestPermission = (DeviceMotionEvent as any)?.requestPermission;
    if (typeof requestPermission === 'function') {
      requestPermission()
        .then((permission: string) => {
          if (permission === 'granted') {
            window.addEventListener('devicemotion', handleMotion);
            cleanupFunctionsRef.current.push(() => window.removeEventListener('devicemotion', handleMotion));
          } else {
            setState((prev) => ({ ...prev, error: 'Motion sensor permission denied' }));
          }
        })
        .catch((err: Error) => {
          setState((prev) => ({ ...prev, error: `Motion sensor error: ${err.message}` }));
        });
      return;
    }

    window.addEventListener('devicemotion', handleMotion);
    cleanupFunctionsRef.current.push(() => window.removeEventListener('devicemotion', handleMotion));
  }, [config.sensitivity, handleKnock]);

  const startMicrophone = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState((prev) => ({ ...prev, error: 'Microphone not supported on this device' }));
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();

      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const threshold = AUDIO_THRESHOLDS[config.sensitivity];
      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      let wasLoud = false;

      const checkAudio = () => {
        if (!analyserRef.current) return;

        analyser.getByteFrequencyData(dataArray);

        const average = dataArray.reduce((a, b) => a + b, 0) / bufferLength / 255;

        if (average > threshold && !wasLoud) {
          wasLoud = true;
          handleKnock(Date.now());
          window.setTimeout(() => {
            wasLoud = false;
          }, DEBOUNCE_TIME);
        }

        animationFrameRef.current = window.requestAnimationFrame(checkAudio);
      };

      checkAudio();

      cleanupFunctionsRef.current.push(() => {
        if (animationFrameRef.current) {
          window.cancelAnimationFrame(animationFrameRef.current);
        }
        stream.getTracks().forEach((track) => track.stop());
        audioContext.close();
      });
    } catch (err) {
      setState((prev) => ({ ...prev, error: `Microphone error: ${(err as Error).message}` }));
    }
  }, [config.sensitivity, handleKnock]);

  const startListening = useCallback(async () => {
    knockTimestampsRef.current = [];
    cleanupFunctionsRef.current = [];
    lastKnockTimeRef.current = 0;

    setState({
      isListening: true,
      knockCount: 0,
      knockTimestamps: [],
      error: null,
    });

    if (config.detectionMode === 'accelerometer' || config.detectionMode === 'both') {
      startAccelerometer();
    }

    if (config.detectionMode === 'microphone' || config.detectionMode === 'both') {
      await startMicrophone();
    }
  }, [config.detectionMode, startAccelerometer, startMicrophone]);

  const stopListening = useCallback(() => {
    setState((prev) => ({ ...prev, isListening: false }));

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    cleanupFunctionsRef.current.forEach((cleanup) => cleanup());
    cleanupFunctionsRef.current = [];

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    analyserRef.current = null;

    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    stopListening();
    knockTimestampsRef.current = [];
    setState({
      isListening: false,
      knockCount: 0,
      knockTimestamps: [],
      error: null,
    });
  }, [stopListening]);

  return {
    ...state,
    startListening,
    stopListening,
    reset,
  };
}
