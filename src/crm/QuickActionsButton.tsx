/**
 * QuickActionsButton - Dropdown button for quick actions (minibots)
 */
import { useState, useEffect, useRef } from "react";
import { Zap, Settings, Plus, Loader2 } from "lucide-react";

export interface QuickAction {
  id: string;
  userId: string;
  name: string;
  command: string | null;
  icon: string;
  type: 'send_files' | 'send_text' | 'send_template' | 'composite';
  config: any;
  delayBetweenMs: number;
  enabled: boolean;
  sortOrder: number;
}

interface QuickActionsButtonProps {
  conversationId: string;
  onOpenManager: () => void;
}

export default function QuickActionsButton({
  conversationId,
  onOpenManager,
}: QuickActionsButtonProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [actions, setActions] = useState<QuickAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Load actions when dropdown opens
  useEffect(() => {
    if (isOpen) {
      loadActions();
      // Focus search input
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearchTerm("");
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!isOpen) return;
      if (event.key === "Escape") {
        setIsOpen(false);
        setSearchTerm("");
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const loadActions = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/crm/quick-actions", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setActions(data.actions || []);
      }
    } catch (error) {
      console.error("Failed to load quick actions:", error);
    } finally {
      setLoading(false);
    }
  };

  const executeAction = async (action: QuickAction) => {
    if (executing) return;

    setExecuting(action.id);
    setIsOpen(false); // Close dropdown immediately
    setSearchTerm("");

    try {
      // Use AbortController for timeout (2 minutes for large files)
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120000);

      const response = await fetch(`/api/crm/quick-actions/${action.id}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ conversationId }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const result = await response.json();

      if (result.success) {
        // Show success feedback
        console.log(`[QuickAction] ✅ "${action.name}" ejecutado: ${result.messagesSent} mensajes enviados`);
      } else {
        console.error(`[QuickAction] ❌ "${action.name}" falló:`, result.errors);
        alert(`Error ejecutando "${action.name}": ${result.errors?.join(", ") || "Error desconocido"}`);
      }
    } catch (error: any) {
      if (error.name === 'AbortError') {
        console.error("[QuickAction] Timeout - la acción tardó demasiado");
        alert("La acción está tardando mucho. Los mensajes se enviarán en segundo plano.");
      } else {
        console.error("[QuickAction] Error:", error);
        alert("Error al ejecutar la acción");
      }
    } finally {
      setExecuting(null);
    }
  };

  // Filter actions by search term
  const filteredActions = actions.filter(action => {
    if (!searchTerm) return action.enabled;
    const term = searchTerm.toLowerCase();
    return (
      action.enabled &&
      (action.name.toLowerCase().includes(term) ||
        action.command?.toLowerCase().includes(term) ||
        action.icon.includes(term))
    );
  });

  // Get action type label
  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'send_files': return 'Archivos';
      case 'send_text': return 'Texto';
      case 'send_template': return 'Plantilla';
      case 'composite': return 'Compuesto';
      default: return type;
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition ${
          isOpen
            ? "bg-amber-100 text-amber-700 border border-amber-300"
            : "bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-600"
        }`}
        title="Acciones Rápidas"
      >
        <Zap className="w-4 h-4" />
        <span className="hidden sm:inline">Acciones</span>
      </button>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-white border border-slate-200 rounded-xl shadow-xl z-[9999] overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-slate-100">
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar acción o comando..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-300 focus:border-amber-300"
            />
          </div>

          {/* Actions list */}
          <div className="max-h-64 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-slate-400">
                <Loader2 className="w-5 h-5 animate-spin mr-2" />
                Cargando...
              </div>
            ) : filteredActions.length === 0 ? (
              <div className="py-8 text-center text-slate-400 text-sm">
                {searchTerm ? (
                  <p>No se encontraron acciones</p>
                ) : (
                  <div>
                    <p className="mb-2">No tienes acciones configuradas</p>
                    <button
                      onClick={() => {
                        setIsOpen(false);
                        onOpenManager();
                      }}
                      className="text-amber-600 hover:text-amber-700 font-medium"
                    >
                      Crear primera acción
                    </button>
                  </div>
                )}
              </div>
            ) : (
              filteredActions.map((action) => (
                <button
                  key={action.id}
                  onClick={() => executeAction(action)}
                  disabled={!!executing}
                  className={`w-full px-4 py-3 text-left hover:bg-amber-50 transition flex items-center gap-3 ${
                    executing === action.id ? "bg-amber-50" : ""
                  } disabled:opacity-50`}
                >
                  {/* Icon */}
                  <span className="text-xl flex-shrink-0">
                    {executing === action.id ? (
                      <Loader2 className="w-5 h-5 animate-spin text-amber-600" />
                    ) : (
                      action.icon
                    )}
                  </span>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-slate-800 truncate">
                      {action.name}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono">{action.command}</span>
                      <span>•</span>
                      <span>{getTypeLabel(action.type)}</span>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 p-2">
            <button
              onClick={() => {
                setIsOpen(false);
                setSearchTerm("");
                onOpenManager();
              }}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 rounded-lg transition"
            >
              <Settings className="w-4 h-4" />
              Configurar acciones
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
