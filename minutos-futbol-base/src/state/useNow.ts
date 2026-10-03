import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * El único "tick" de la UI (docs/03 §3.4). No cuenta nada: solo provoca el
 * repintado para que los tiempos, que son diferencias de marcas, se vuelvan a
 * calcular. Al volver a primer plano se actualiza de inmediato para que no se
 * vea un segundo el valor viejo.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, intervalMs);
    const sub = AppState.addEventListener('change', (status) => {
      if (status === 'active') tick();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [intervalMs]);
  return now;
}
