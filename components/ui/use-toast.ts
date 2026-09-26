import { useState } from 'react';

export function useToast() {
  const toast = ({ title, description, variant }: { title?: string; description?: string; variant?: string }) => {
    console.log(`[Toast] ${title}: ${description} (${variant || 'default'})`);
    // Create a temporary non-blocking browser alert
    if (typeof window !== 'undefined') {
      const toastDiv = document.createElement('div');
      toastDiv.style.position = 'fixed';
      toastDiv.style.bottom = '20px';
      toastDiv.style.right = '20px';
      toastDiv.style.backgroundColor = variant === 'destructive' ? '#ef4444' : '#10b981';
      toastDiv.style.color = '#fff';
      toastDiv.style.padding = '12px 24px';
      toastDiv.style.borderRadius = '8px';
      toastDiv.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
      toastDiv.style.zIndex = '99999';
      toastDiv.style.fontFamily = 'sans-serif';
      toastDiv.style.fontSize = '14px';
      
      toastDiv.innerHTML = `<strong>${title || ''}</strong><p style="margin:4px 0 0 0">${description || ''}</p>`;
      document.body.appendChild(toastDiv);
      
      setTimeout(() => {
        toastDiv.style.opacity = '0';
        toastDiv.style.transition = 'opacity 0.5s ease';
        setTimeout(() => {
          document.body.removeChild(toastDiv);
        }, 500);
      }, 3000);
    }
  };
  
  return { toast };
}
