/**
 * AvatarWithBadge - Avatar que se reemplaza por badge de ventana cuando hay avisos
 *
 * Muestra el avatar normal cuando el chat está seguro (>12h restantes).
 * Cuando hay avisos activos, reemplaza el avatar completamente por el badge
 * con animación de pulso y color apropiado.
 * El badge alterna entre mostrar el icono y el tiempo restante.
 */

import { useMemo, useState, useEffect } from 'react';
import { calculateWindowStatus, type WindowStatus } from '../../shared/window-utils';
import { User } from 'lucide-react';

interface AvatarWithBadgeProps {
  lastClientMessageAt: number | null | undefined;
  avatarUrl?: string | null;
  contactName?: string | null;
}

export function AvatarWithBadge({ lastClientMessageAt, avatarUrl, contactName }: AvatarWithBadgeProps) {
  const [imageError, setImageError] = useState(false);

  const windowInfo = useMemo(
    () => calculateWindowStatus(lastClientMessageAt),
    [lastClientMessageAt]
  );

  // Si está en estado "safe", mostrar avatar normal
  if (windowInfo.status === 'safe') {
    return (
      <div className="relative h-10 w-10 flex-shrink-0">
        {avatarUrl && !imageError ? (
          <img
            src={avatarUrl}
            alt={contactName || 'Avatar'}
            className="h-10 w-10 rounded-full object-cover bg-slate-200"
            onError={() => setImageError(true)}
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-slate-200 flex items-center justify-center">
            <User className="h-6 w-6 text-slate-500" />
          </div>
        )}
      </div>
    );
  }

  // Si hay aviso, reemplazar por badge con animación
  return (
    <WindowBadgeAvatar
      status={windowInfo.status}
      minutesRemaining={windowInfo.minutesRemaining}
      hoursRemaining={windowInfo.hoursRemaining}
    />
  );
}

interface WindowBadgeAvatarProps {
  status: WindowStatus;
  minutesRemaining: number | null;
  hoursRemaining: number | null;
}

function WindowBadgeAvatar({ status, minutesRemaining, hoursRemaining }: WindowBadgeAvatarProps) {
  const [showIcon, setShowIcon] = useState(true);
  const config = getBadgeConfig(status, minutesRemaining);

  // Alternar entre icono y tiempo cada 2 segundos
  useEffect(() => {
    const interval = setInterval(() => {
      setShowIcon((prev) => !prev);
    }, 2000); // Cambia cada 2 segundos

    return () => clearInterval(interval);
  }, []);

  // Determinar qué texto mostrar cuando no es el icono
  const timeText = getTimeText(status, minutesRemaining, hoursRemaining);

  return (
    <div className="relative h-10 w-10 flex-shrink-0">
      <div
        className={`h-10 w-10 rounded-full flex items-center justify-center ${config.bgColor} ${config.animation}`}
        title={config.tooltip}
      >
        {showIcon ? (
          <span key="icon" className="text-xl animate-fade-in">{config.icon}</span>
        ) : (
          <span key="time" className="text-xs font-bold animate-fade-in">{timeText}</span>
        )}
      </div>
    </div>
  );
}

function getTimeText(status: WindowStatus, minutesRemaining: number | null, hoursRemaining: number | null): string {
  switch (status) {
    case 'critical':
      return `${minutesRemaining}m`;
    case 'urgent':
    case 'warning':
      return `${hoursRemaining}h`;
    case 'expired':
      return '24h+';
    default:
      return '';
  }
}

interface BadgeConfig {
  icon: string;
  bgColor: string;
  animation: string;
  tooltip: string;
}

function getBadgeConfig(status: WindowStatus, minutesRemaining: number | null): BadgeConfig {
  switch (status) {
    case 'warning':
      return {
        icon: '⚠️',
        bgColor: 'bg-yellow-400',
        animation: 'animate-pulse-slow',
        tooltip: 'Ventana expira en menos de 12 horas'
      };

    case 'urgent':
      return {
        icon: '⏰',
        bgColor: 'bg-orange-500',
        animation: 'animate-pulse-medium',
        tooltip: 'Ventana expira en menos de 6 horas - Prioriza este chat'
      };

    case 'critical':
      return {
        icon: '🚨',
        bgColor: 'bg-red-500 shadow-red-500/50',
        animation: 'animate-pulse-fast shadow-lg',
        tooltip: `¡URGENTE! Ventana expira en ${minutesRemaining} minutos`
      };

    case 'expired':
      return {
        icon: '🔒',
        bgColor: 'bg-gray-500',
        animation: '',
        tooltip: 'Ventana expirada - Solo plantillas'
      };

    default:
      return {
        icon: '❓',
        bgColor: 'bg-gray-400',
        animation: '',
        tooltip: 'Estado desconocido'
      };
  }
}
