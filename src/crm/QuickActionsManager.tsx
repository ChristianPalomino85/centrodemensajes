/**
 * QuickActionsManager - Modal for managing quick actions
 */
import { useState, useEffect } from "react";
import { X, Plus, Trash2, Edit, GripVertical, Eye, EyeOff, Loader2 } from "lucide-react";
import QuickActionEditor from "./QuickActionEditor";
import type { QuickAction } from "./QuickActionsButton";

interface QuickActionsManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function QuickActionsManager({ isOpen, onClose }: QuickActionsManagerProps) {
  const [actions, setActions] = useState<QuickAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingAction, setEditingAction] = useState<QuickAction | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadActions();
    }
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

  const handleToggle = async (action: QuickAction) => {
    try {
      const response = await fetch(`/api/crm/quick-actions/${action.id}/toggle`, {
        method: "POST",
        credentials: "include",
      });
      if (response.ok) {
        setActions(prev =>
          prev.map(a => (a.id === action.id ? { ...a, enabled: !a.enabled } : a))
        );
      }
    } catch (error) {
      console.error("Failed to toggle action:", error);
    }
  };

  const handleDelete = async (action: QuickAction) => {
    if (!confirm(`¿Eliminar la acción "${action.name}"?`)) return;

    setDeletingId(action.id);
    try {
      const response = await fetch(`/api/crm/quick-actions/${action.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (response.ok) {
        setActions(prev => prev.filter(a => a.id !== action.id));
      }
    } catch (error) {
      console.error("Failed to delete action:", error);
    } finally {
      setDeletingId(null);
    }
  };

  const handleSave = async (actionData: Partial<QuickAction>) => {
    try {
      let response;

      if (editingAction) {
        // Update
        response = await fetch(`/api/crm/quick-actions/${editingAction.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(actionData),
        });
      } else {
        // Create
        response = await fetch("/api/crm/quick-actions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(actionData),
        });
      }

      if (response.ok) {
        await loadActions();
        setEditingAction(null);
        setIsCreating(false);
      } else {
        const error = await response.json();
        alert(`Error: ${error.error || "No se pudo guardar"}`);
      }
    } catch (error) {
      console.error("Failed to save action:", error);
      alert("Error al guardar la acción");
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'send_files': return 'Enviar archivos';
      case 'send_text': return 'Enviar texto';
      case 'send_template': return 'Plantilla';
      case 'composite': return 'Compuesto';
      default: return type;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'send_files': return 'bg-blue-100 text-blue-700';
      case 'send_text': return 'bg-green-100 text-green-700';
      case 'send_template': return 'bg-purple-100 text-purple-700';
      case 'composite': return 'bg-amber-100 text-amber-700';
      default: return 'bg-slate-100 text-slate-700';
    }
  };

  if (!isOpen) return null;

  // Show editor
  if (editingAction || isCreating) {
    return (
      <QuickActionEditor
        action={editingAction}
        onSave={handleSave}
        onCancel={() => {
          setEditingAction(null);
          setIsCreating(false);
        }}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10000]">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Mis Acciones Rápidas</h2>
            <p className="text-sm text-slate-500">Configura tus minibots y scripts personalizados</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
            </div>
          ) : actions.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-5xl mb-4">⚡</div>
              <h3 className="text-lg font-semibold text-slate-700 mb-2">
                No tienes acciones configuradas
              </h3>
              <p className="text-slate-500 mb-6">
                Crea tu primera acción rápida para agilizar tu trabajo
              </p>
              <button
                onClick={() => setIsCreating(true)}
                className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 transition flex items-center gap-2 mx-auto"
              >
                <Plus className="w-4 h-4" />
                Crear primera acción
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {actions.map((action) => (
                <div
                  key={action.id}
                  className={`flex items-center gap-4 p-4 rounded-xl border ${
                    action.enabled
                      ? "bg-white border-slate-200"
                      : "bg-slate-50 border-slate-100 opacity-60"
                  }`}
                >
                  {/* Drag handle */}
                  <div className="text-slate-300 cursor-move">
                    <GripVertical className="w-5 h-5" />
                  </div>

                  {/* Icon */}
                  <div className="text-2xl">{action.icon}</div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-800">{action.name}</span>
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${getTypeColor(action.type)}`}>
                        {getTypeLabel(action.type)}
                      </span>
                    </div>
                    <div className="text-sm text-slate-400 font-mono">{action.command}</div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggle(action)}
                      className={`p-2 rounded-lg transition ${
                        action.enabled
                          ? "text-green-600 hover:bg-green-50"
                          : "text-slate-400 hover:bg-slate-100"
                      }`}
                      title={action.enabled ? "Desactivar" : "Activar"}
                    >
                      {action.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <button
                      onClick={() => setEditingAction(action)}
                      className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                      title="Editar"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(action)}
                      disabled={deletingId === action.id}
                      className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition disabled:opacity-50"
                      title="Eliminar"
                    >
                      {deletingId === action.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        {actions.length > 0 && (
          <div className="px-6 py-4 border-t border-slate-200">
            <button
              onClick={() => setIsCreating(true)}
              className="w-full px-4 py-3 bg-amber-500 text-white rounded-xl hover:bg-amber-600 transition flex items-center justify-center gap-2 font-medium"
            >
              <Plus className="w-5 h-5" />
              Nueva Acción
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
