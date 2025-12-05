/**
 * WindowBadge - Indicador visual de ventana de mensajería de WhatsApp (24 horas)
 *
 * Muestra el tiempo restante o vencimiento de la ventana de mensajería gratuita.
 * Se integra en la lista de conversaciones sin generar saltos de línea.
 *
 * IMPORTANT: Solo muestra badge cuando quedan <12h o ya expiró (>24h)
 * Last updated: 2025-11-24 03:23
 */

import { useMemo } from 'react';
import {
  calculateWindowStatus,
  getWindowBadgeText,
  getWindowBadgeClasses,
  shouldShowWindowBadge,
  type WindowInfo,
} from '../../shared/window-utils';

interface WindowBadgeProps {
  /** Timestamp del último mensaje del cliente (incoming) */
  lastClientMessageAt: number | null | undefined;
  /** Estilo compacto (solo para casos especiales, default: false) */
  compact?: boolean;
}

/**
 * Badge que muestra el estado de la ventana de 24 horas de WhatsApp
 *
 * Estados:
 * - 🚨 CRÍTICO (<1h): Rojo, parpadeante, muestra minutos
 * - ⏰ URGENTE (1-6h): Naranja, muestra horas
 * - ⚠️ ADVERTENCIA (6-12h): Amarillo, muestra horas
 * - 🔒 VENCIDO (>24h): Gris, solo icono de candado
 * - SEGURO (>12h): No se muestra
 */
export function WindowBadge({ lastClientMessageAt, compact = false }: WindowBadgeProps) {
  const windowInfo = useMemo(
    () => {
      // DEBUG: Log para verificar qué estamos recibiendo
      if (typeof lastClientMessageAt === 'undefined' || lastClientMessageAt === null) {
        console.log('[WindowBadge] ⚠️ lastClientMessageAt is null/undefined:', lastClientMessageAt);
      }
      return calculateWindowStatus(lastClientMessageAt);
    },
    [lastClientMessageAt]
  );

  // No mostrar si está en estado "safe" (>12h restantes)
  if (!shouldShowWindowBadge(windowInfo.status)) {
    return null;
  }

  const text = getWindowBadgeText(windowInfo);
  const classes = getWindowBadgeClasses(windowInfo.status);

  // Modo compacto: solo icono (para casos especiales)
  if (compact) {
    return <span className="text-xs">{text}</span>;
  }

  // Modo normal: badge completo
  return (
    <span className={classes} title={getTooltipText(windowInfo)}>
      {text}
    </span>
  );
}

/**
 * Genera el texto del tooltip con información detallada
 */
function getTooltipText(windowInfo: WindowInfo): string {
  switch (windowInfo.status) {
    case 'critical':
      return `Ventana de mensajería expira en ${windowInfo.minutesRemaining} minutos. Responde pronto o necesitarás enviar una plantilla.`;
    case 'urgent':
      return `Ventana de mensajería expira en ${windowInfo.hoursRemaining} horas. Prioriza este chat.`;
    case 'warning':
      return `Ventana de mensajería expira en ${windowInfo.hoursRemaining} horas.`;
    case 'expired':
      return 'Ventana de mensajería expirada. Solo puedes enviar plantillas aprobadas o esperar a que el cliente te escriba.';
    default:
      return '';
  }
}
