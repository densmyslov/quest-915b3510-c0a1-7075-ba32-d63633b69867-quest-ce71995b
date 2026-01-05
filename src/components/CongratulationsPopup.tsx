'use client';

import React, { useCallback, useEffect, useState } from 'react';

export type CongratulationsPopupProps = {
  points: number;
  onClose: () => void;
  autoCloseMs?: number;
};

export function CongratulationsPopup({ points, onClose, autoCloseMs }: CongratulationsPopupProps) {
  const [isVisible, setIsVisible] = useState(false);

  const handleClose = useCallback(() => {
    setIsVisible(false);
    // Wait for animation to complete before calling onClose
    setTimeout(onClose, 300);
  }, [onClose]);

  useEffect(() => {
    // Trigger animation after mount
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!autoCloseMs) return;
    const timer = setTimeout(() => handleClose(), autoCloseMs);
    return () => clearTimeout(timer);
  }, [autoCloseMs, handleClose]);

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 300ms ease-in-out',
      }}
      onClick={handleClose}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: '16px',
          padding: '32px',
          maxWidth: '400px',
          width: '90%',
          textAlign: 'center',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
          transform: isVisible ? 'scale(1)' : 'scale(0.9)',
          transition: 'transform 300ms ease-in-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            fontSize: '48px',
            marginBottom: '16px',
          }}
        >
          🎉
        </div>
        <h2
          style={{
            fontSize: '24px',
            fontWeight: 'bold',
            color: '#1a202c',
            marginBottom: '16px',
          }}
        >
          Congratulations!
        </h2>
        <p
          style={{
            fontSize: '18px',
            color: '#4a5568',
            marginBottom: '24px',
          }}
        >
          You won <strong style={{ color: '#2d3748', fontSize: '20px' }}>{points}</strong> {points === 1 ? 'vote' : 'votes'}
        </p>
        <button
          onClick={handleClose}
          style={{
            backgroundColor: '#3b82f6',
            color: '#ffffff',
            border: 'none',
            borderRadius: '8px',
            padding: '12px 32px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: 'pointer',
            transition: 'background-color 200ms ease-in-out',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#2563eb')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#3b82f6')}
        >
          Close
        </button>
      </div>
    </div>
  );
}
