import React, { useEffect, useRef } from 'react';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  color: string;
  source: 'mic' | 'screen';
}

export const Visualizer: React.FC<{ isActive: boolean; micVolume: number; screenVolume: number }> = ({ isActive, micVolume, screenVolume }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationId: number;
    let particles: Particle[] = [];
    
    // Initialize particles
    const particleCount = 120;
    for(let i=0; i<particleCount; i++) {
       const isMic = i < particleCount / 2;
       particles.push({
         x: (Math.random() - 0.5) * 200,
         y: (Math.random() - 0.5) * 200,
         z: Math.random() * 200, // depth
         vx: (Math.random() - 0.5) * 0.5,
         vy: (Math.random() - 0.5) * 0.5,
         vz: (Math.random() - 0.5) * 0.5,
         size: Math.random() * 2 + 1,
         color: isMic ? '#4daafc' : '#9b8afb',
         source: isMic ? 'mic' : 'screen'
       });
    }

    let angleY = 0;
    let angleX = 0;

    const draw = () => {
      // Handle canvas resize
      const width = canvas.width = canvas.offsetWidth;
      const height = canvas.height = canvas.offsetHeight;
      
      ctx.clearRect(0, 0, width, height);
      
      if (!isActive) {
          // Idle state text
          ctx.fillStyle = '#6b7280';
          ctx.font = '14px monospace';
          ctx.textAlign = 'center';
          ctx.fillText('Waiting for connection...', width/2, height/2);
          return;
      }

      const centerX = width / 2;
      const centerY = height / 2;
      
      // Calculate total volume reaction
      const totalVolume = Math.max(micVolume, screenVolume);
      
      // Sphere Base Radius
      const baseRadius = 40;
      const expansion = Math.min(totalVolume * 150, 60); 
      const breathing = Math.sin(Date.now() / 1000) * 5;
      
      const radius = baseRadius + expansion + breathing;
      
      // Draw Glow/Atmosphere - Blend colors based on dominant source
      const micWeight = micVolume / (totalVolume || 1);
      const screenWeight = screenVolume / (totalVolume || 1);
      
      // Simple color mixing for the glow
      // Mic is Blue (77, 170, 252), Screen is Purple (155, 138, 251)
      const r = 77 * micWeight + 155 * screenWeight;
      const g = 170 * micWeight + 138 * screenWeight;
      const b = 252 * micWeight + 251 * screenWeight;
      
      const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius * 2);
      const opacity = 0.6 + Math.min(totalVolume * 2, 0.4); 
      
      gradient.addColorStop(0, `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${opacity})`); 
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
      
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 2, 0, Math.PI * 2);
      ctx.fill();

      // Draw Solid Core
      const coreGradient = ctx.createRadialGradient(centerX - radius*0.3, centerY - radius*0.3, 0, centerX, centerY, radius);
      coreGradient.addColorStop(0, '#ffffff');
      coreGradient.addColorStop(0.3, `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, 1)`);
      coreGradient.addColorStop(1, '#1e1e1e');
      
      ctx.fillStyle = coreGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
      ctx.fill();

      // Rotate particles
      angleY += 0.01 + (totalVolume * 0.05); 
      angleX += 0.005 + (totalVolume * 0.02);

      // Draw Particles
      particles.forEach(p => {
          // Determine activity for this particle source
          const sourceVol = p.source === 'mic' ? micVolume : screenVolume;
          
          let x = p.x;
          let y = p.y;
          let z = p.z;

          // Rotate
          let cosY = Math.cos(angleY);
          let sinY = Math.sin(angleY);
          let x1 = x * cosY - z * sinY;
          let z1 = z * cosY + x * sinY;
          
          let cosX = Math.cos(angleX);
          let sinX = Math.sin(angleX);
          let y1 = y * cosX - z1 * sinX;
          let z2 = z1 * cosX + y * sinX;

          const fov = 300;
          const scale = fov / (fov + z2);
          const x2d = x1 * scale + centerX;
          const y2d = y1 * scale + centerY;

          // Specific "Excitement" push based on source volume
          const push = 1 + (sourceVol * 0.8);
          
          const finalX = (x2d - centerX) * push + centerX;
          const finalY = (y2d - centerY) * push + centerY;
          
          ctx.fillStyle = p.color;
          // Fade based on its specific source volume + depth
          // If source has low volume, particle is dimmer
          const alpha = Math.max(0.2, scale * 0.8 + (sourceVol * 0.8));
          ctx.globalAlpha = Math.min(1.0, alpha); 
          
          ctx.beginPath();
          ctx.arc(finalX, finalY, p.size * scale * (1 + sourceVol), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1.0;
      });

      animationId = requestAnimationFrame(draw);
    };

    draw();
    return () => cancelAnimationFrame(animationId);
  }, [isActive, micVolume, screenVolume]);

  return (
    <div className="w-full h-full flex items-center justify-center bg-black/20 backdrop-blur-sm rounded-xl overflow-hidden relative">
         <canvas ref={canvasRef} className="w-full h-full object-contain" />
         
         {/* Legend for Visualizer */}
         {isActive && (
            <div className="absolute bottom-4 left-0 right-0 flex justify-center gap-6 pointer-events-none">
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gemini-blue animate-pulse" style={{ opacity: Math.max(0.4, micVolume * 2) }}></span>
                    <span className="text-[10px] text-gemini-blue/80 font-mono">MIC</span>
                </div>
                <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-gemini-purple animate-pulse" style={{ opacity: Math.max(0.4, screenVolume * 2) }}></span>
                    <span className="text-[10px] text-gemini-purple/80 font-mono">SCREEN</span>
                </div>
            </div>
         )}
    </div>
  );
};