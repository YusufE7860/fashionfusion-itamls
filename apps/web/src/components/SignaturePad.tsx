import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';

/**
 * Lightweight HTML5-canvas signature pad. Returns a PNG data URL via onChange.
 * Pointer events cover mouse, pen and touch on one path.
 */
export function SignaturePad({
  onChange,
  height = 180,
  className,
}: {
  onChange: (dataUrl: string | null) => void;
  height?: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const [isDirty, setDirty] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#ffffff';
  }, []);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function start(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    drawingRef.current = true;
    lastRef.current = pos(e);
    canvasRef.current!.setPointerCapture(e.pointerId);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const p = pos(e);
    if (lastRef.current) {
      ctx.beginPath();
      ctx.moveTo(lastRef.current.x, lastRef.current.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    lastRef.current = p;
    if (!isDirty) setDirty(true);
  }
  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;
    try { canvasRef.current!.releasePointerCapture(e.pointerId); } catch {}
    onChange(canvasRef.current!.toDataURL('image/png'));
  }
  function clear() {
    const c = canvasRef.current!;
    const ctx = c.getContext('2d')!;
    ctx.clearRect(0, 0, c.width, c.height);
    setDirty(false);
    onChange(null);
  }

  return (
    <div className={className}>
      <div className="relative overflow-hidden rounded-md border border-ink-500/60 bg-ink-900/60" style={{ height }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 h-full w-full touch-none cursor-crosshair"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
        {!isDirty && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-ink-200">
            Sign here
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] text-ink-200">
        <span>{isDirty ? 'Signature captured' : 'Use mouse, pen or finger to sign'}</span>
        <button type="button" onClick={clear} className="btn-ghost text-xs">
          <Eraser size={12}/>Clear
        </button>
      </div>
    </div>
  );
}
