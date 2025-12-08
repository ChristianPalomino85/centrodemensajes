import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface NodePaletteProps {
  onNodeCreate: (nodeType: string) => void;
}

const NODE_CATEGORIES = {
  estructura: [
    { type: 'menu', label: 'Menú', icon: '☰', color: 'bg-emerald-500 hover:bg-emerald-600' },
    { type: 'simple-menu', label: 'Menú simple (texto)', icon: '📝', color: 'bg-emerald-500 hover:bg-emerald-600' }
  ],
  mensajes: [
    { type: 'message', label: 'Mensaje', icon: '💬', color: 'bg-emerald-500 hover:bg-emerald-600' },
    { type: 'buttons', label: 'Botones', icon: '🔘', color: 'bg-emerald-500 hover:bg-emerald-600' },
    { type: 'question', label: 'Pregunta', icon: '❓', color: 'bg-emerald-500 hover:bg-emerald-600' },
    { type: 'attachment', label: 'Adjunto', icon: '📎', color: 'bg-emerald-500 hover:bg-emerald-600' }
  ],
  integraciones: [
    { type: 'webhook_out', label: 'Webhook OUT', icon: '🔗', color: 'bg-blue-500 hover:bg-blue-600' },
    { type: 'webhook_in', label: 'Webhook IN', icon: '📥', color: 'bg-blue-500 hover:bg-blue-600' },
    { type: 'bitrix_crm', label: 'Crear en Bitrix', icon: '+', color: 'bg-orange-500 hover:bg-orange-600' }
  ],
  logica: [
    { type: 'validation', label: 'Validación', icon: '✓', color: 'bg-cyan-500 hover:bg-cyan-600' },
    { type: 'validation_bitrix', label: 'Validación Bitrix', icon: '✓', color: 'bg-cyan-500 hover:bg-cyan-600' },
    { type: 'scheduler', label: 'Scheduler', icon: '🕐', color: 'bg-cyan-500 hover:bg-cyan-600' },
    { type: 'handoff', label: 'Handoff (Humano)', icon: '👤', color: 'bg-cyan-500 hover:bg-cyan-600' },
    { type: 'transfer', label: 'Transferir', icon: '🔄', color: 'bg-cyan-500 hover:bg-cyan-600' }
  ],
  ia: [
    { type: 'ia_rag', label: 'IA - RAG', icon: '💡', color: 'bg-purple-500 hover:bg-purple-600' },
    { type: 'tool', label: 'Tool/Acción externa', icon: '🔧', color: 'bg-purple-500 hover:bg-purple-600' }
  ],
  control: [
    { type: 'delay', label: 'Delay (Espera)', icon: '⏱️', color: 'bg-slate-500 hover:bg-slate-600' },
    { type: 'end', label: 'Finalizar flujo', icon: '🏁', color: 'bg-slate-500 hover:bg-slate-600' }
  ]
};

export default function NodePalette({ onNodeCreate }: NodePaletteProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);

  return (
    <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 z-30 pointer-events-auto">
      <div className={`bg-card rounded-xl shadow-2xl border border-border transition-all duration-300 ${isCollapsed ? 'pb-2' : 'pb-4'}`}>
        {/* Toggle Button */}
        <div className="flex justify-center pt-2">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="px-4 py-1 text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
            type="button"
          >
            {isCollapsed ? (
              <>
                <ChevronUp className="w-3 h-3" />
                Mostrar nodos
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                Ocultar nodos
              </>
            )}
          </button>
        </div>

        {/* Node Buttons */}
        {!isCollapsed && (
          <div className="px-4 pt-2">
            <div className="flex gap-4">
              {/* ESTRUCTURA */}
              <div className="flex flex-col gap-2 min-w-[140px]">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">ESTRUCTURA</div>
                {NODE_CATEGORIES.estructura.map(node => (
                  <button
                    key={node.type}
                    onClick={() => onNodeCreate(node.type)}
                    className={`${node.color} text-white px-3 py-2 rounded-lg text-xs font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2 justify-center`}
                    type="button"
                  >
                    <span>{node.icon}</span>
                    <span>{node.label}</span>
                  </button>
                ))}
              </div>

              {/* MENSAJES */}
              <div className="flex flex-col gap-2 min-w-[140px]">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">MENSAJES</div>
                {NODE_CATEGORIES.mensajes.map(node => (
                  <button
                    key={node.type}
                    onClick={() => onNodeCreate(node.type)}
                    className={`${node.color} text-white px-3 py-2 rounded-lg text-xs font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2 justify-center`}
                    type="button"
                  >
                    <span>{node.icon}</span>
                    <span>{node.label}</span>
                  </button>
                ))}
              </div>

              {/* INTEGRACIONES */}
              <div className="flex flex-col gap-2 min-w-[160px]">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">INTEGRACIONES</div>
                {NODE_CATEGORIES.integraciones.map(node => (
                  <button
                    key={node.type}
                    onClick={() => onNodeCreate(node.type)}
                    className={`${node.color} text-white px-3 py-2 rounded-lg text-xs font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2 justify-center`}
                    type="button"
                  >
                    <span>{node.icon}</span>
                    <span>{node.label}</span>
                  </button>
                ))}
              </div>

              {/* LÓGICA */}
              <div className="flex flex-col gap-2 min-w-[170px]">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">LÓGICA</div>
                {NODE_CATEGORIES.logica.map(node => (
                  <button
                    key={node.type}
                    onClick={() => onNodeCreate(node.type)}
                    className={`${node.color} text-white px-3 py-2 rounded-lg text-xs font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2 justify-center`}
                    type="button"
                  >
                    <span>{node.icon}</span>
                    <span>{node.label}</span>
                  </button>
                ))}
              </div>

              {/* INTELIGENCIA ARTIFICIAL */}
              <div className="flex flex-col gap-2 min-w-[180px]">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">INTELIGENCIA ARTIFICIAL</div>
                {NODE_CATEGORIES.ia.map(node => (
                  <button
                    key={node.type}
                    onClick={() => onNodeCreate(node.type)}
                    className={`${node.color} text-white px-3 py-2 rounded-lg text-xs font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2 justify-center`}
                    type="button"
                  >
                    <span>{node.icon}</span>
                    <span>{node.label}</span>
                  </button>
                ))}
              </div>

              {/* CONTROL */}
              <div className="flex flex-col gap-2 min-w-[150px]">
                <div className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">CONTROL</div>
                {NODE_CATEGORIES.control.map(node => (
                  <button
                    key={node.type}
                    onClick={() => onNodeCreate(node.type)}
                    className={`${node.color} text-white px-3 py-2 rounded-lg text-xs font-medium transition-all shadow-sm hover:shadow-md flex items-center gap-2 justify-center`}
                    type="button"
                  >
                    <span>{node.icon}</span>
                    <span>{node.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
