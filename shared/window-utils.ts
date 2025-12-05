/**
 * Utilidades para calcular el estado de la ventana de mensajería de WhatsApp (24 horas)
 *
 * La ventana de mensajería de WhatsApp permite enviar mensajes gratuitos durante
 * 24 horas después del último mensaje del CLIENTE (incoming).
 * Después de 24 horas, solo se pueden enviar plantillas aprobadas.
 */

export type WindowStatus = 'safe' | 'warning' | 'urgent' | 'critical' | 'expired';

export interface WindowInfo {
  status: WindowStatus;
  hoursRemaining: number | null;
  minutesRemaining: number | null;
  hoursExpired: number | null;
  canSendFreeMessage: boolean;
  requiresTemplate: boolean;
}

const HOUR = 60 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * HOUR;

/**
 * Calcula el estado de la ventana de mensajería basado en el último mensaje del cliente
 * @param lastClientMessageTimestamp - Timestamp del último mensaje incoming del cliente
 * @returns Información sobre el estado de la ventana
 */
export function calculateWindowStatus(lastClientMessageTimestamp: number | null | undefined): WindowInfo {
  // Si no hay timestamp, asumimos que está vencido
  if (!lastClientMessageTimestamp) {
    return {
      status: 'expired',
      hoursRemaining: null,
      minutesRemaining: null,
      hoursExpired: null,
      canSendFreeMessage: false,
      requiresTemplate: true,
    };
  }

  const now = Date.now();
  const elapsed = now - lastClientMessageTimestamp;

  // Ya expiró (>24 horas)
  if (elapsed > TWENTY_FOUR_HOURS) {
    const hoursExpired = (elapsed - TWENTY_FOUR_HOURS) / HOUR;
    return {
      status: 'expired',
      hoursRemaining: null,
      minutesRemaining: null,
      hoursExpired,
      canSendFreeMessage: false,
      requiresTemplate: true,
    };
  }

  // Aún dentro de la ventana
  const remaining = TWENTY_FOUR_HOURS - elapsed;
  const hoursRemaining = remaining / HOUR;
  const minutesRemaining = remaining / (60 * 1000);

  // Estados según tiempo restante
  if (hoursRemaining < 1) {
    // CRITICAL: <1 hora restante
    return {
      status: 'critical',
      hoursRemaining,
      minutesRemaining: Math.floor(minutesRemaining),
      hoursExpired: null,
      canSendFreeMessage: true,
      requiresTemplate: false,
    };
  }

  if (hoursRemaining < 6) {
    // URGENT: 1-6 horas restantes
    return {
      status: 'urgent',
      hoursRemaining: Math.floor(hoursRemaining),
      minutesRemaining: null,
      hoursExpired: null,
      canSendFreeMessage: true,
      requiresTemplate: false,
    };
  }

  if (hoursRemaining < 12) {
    // WARNING: 6-12 horas restantes
    return {
      status: 'warning',
      hoursRemaining: Math.floor(hoursRemaining),
      minutesRemaining: null,
      hoursExpired: null,
      canSendFreeMessage: true,
      requiresTemplate: false,
    };
  }

  // SAFE: >12 horas restantes
  return {
    status: 'safe',
    hoursRemaining: Math.floor(hoursRemaining),
    minutesRemaining: null,
    hoursExpired: null,
    canSendFreeMessage: true,
    requiresTemplate: false,
  };
}

/**
 * Formatea el texto del badge según el estado
 */
export function getWindowBadgeText(windowInfo: WindowInfo): string {
  switch (windowInfo.status) {
    case 'critical':
      return `🚨 ${windowInfo.minutesRemaining}min`;
    case 'urgent':
      return `⏰ ${windowInfo.hoursRemaining}h`;
    case 'warning':
      return `⚠️ ${windowInfo.hoursRemaining}h`;
    case 'expired':
      return '🔒';
    case 'safe':
    default:
      return '';
  }
}

/**
 * Obtiene las clases de estilo para el badge según el estado
 */
export function getWindowBadgeClasses(status: WindowStatus): string {
  const baseClasses = 'inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold';

  switch (status) {
    case 'critical':
      return `${baseClasses} bg-red-500 text-white animate-pulse`;
    case 'urgent':
      return `${baseClasses} bg-orange-500 text-white`;
    case 'warning':
      return `${baseClasses} bg-yellow-500 text-yellow-900`;
    case 'expired':
      return `${baseClasses} bg-gray-500 text-white`;
    case 'safe':
    default:
      return baseClasses;
  }
}

/**
 * Verifica si se debe mostrar el badge (no mostrar si está "safe")
 */
export function shouldShowWindowBadge(status: WindowStatus): boolean {
  return status !== 'safe';
}
