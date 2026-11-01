import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * Renders a fixed-width print sheet (mm sized) so it always fits the screen.
 * Without this, an A4 sheet inside a phone viewport is wider than the page and
 * flex centering pushes its start edge out of reach of the scroll area.
 * Print styles reset the transform, so the paper itself is never affected.
 */
export function PaperFit({ width, children, className = '' }: { width: string; children: ReactNode; className?: string }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ scale: 1, height: 0 });

  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const measure = () => {
      const natural = inner.offsetWidth;
      const avail = outer.clientWidth;
      if (!natural || !avail) return;
      const scale = Math.min(1, Math.max(0.45, avail / natural));
      setBox({ scale, height: inner.offsetHeight * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={outerRef} className={`paper-fit relative w-full ${className}`} style={{ height: box.height || undefined }}>
      <div
        ref={innerRef}
        className="paper-fit-inner absolute left-0 top-0"
        style={{ width, transform: `scale(${box.scale})`, transformOrigin: 'top left' }}
      >
        {children}
      </div>
    </div>
  );
}
