import { useState } from "react";
import { UserManagement } from "./Configuration/UserManagement";
import { RoleManagement } from "./Configuration/RoleManagement";
import { QueueManagement } from "./Configuration/QueueManagement";
import { CRMFieldConfig } from "./Configuration/CRMFieldConfig";
import { GeneralSettings } from "./Configuration/GeneralSettings";
import { StatusManagement } from "./Configuration/StatusManagement";
import { WhatsAppNumbersPanel } from "./WhatsAppNumbersPanel";
import { WhatsAppConfigContent } from "./WhatsAppConfig";
import { Bitrix24Panel } from "./Bitrix24Panel";
import { SocialChannelsPanel } from "./SocialChannelsPanel";
import { AIConfig } from "./Configuration/AIConfig";
import { IAAgentConfig } from "./Configuration/IAAgentConfig";
import { BotConfig } from "./Configuration/BotConfig";
import { AdvisorStats } from "./Configuration/AdvisorStats";
import { MaintenanceControlPanel } from "./MaintenanceAlert";
import type { WhatsAppNumberAssignment } from "../flow/types";

type ConfigSection = "users" | "roles" | "queues" | "crm-fields" | "whatsapp" | "bitrix24" | "social-channels" | "ai" | "ia-agent" | "statuses" | "general" | "bot" | "advisor-stats" | "maintenance";

interface ConfigurationPanelProps {
  whatsappNumbers?: WhatsAppNumberAssignment[];
  onUpdateWhatsappNumbers?: (numbers: WhatsAppNumberAssignment[]) => void;
  user?: { id: string; role: string; name?: string; username?: string } | null;
}

export function ConfigurationPanel({ whatsappNumbers = [], onUpdateWhatsappNumbers, user }: ConfigurationPanelProps = {}) {
  // Determinar sección inicial según el rol
  const [activeSection, setActiveSection] = useState<ConfigSection>(() => {
    return user?.role === 'supervisor' ? 'queues' : 'users';
  });
  const [whatsappSubSection, setWhatsappSubSection] = useState<'connections' | 'numbers'>('connections');

  // Secciones permitidas para supervisores
  const supervisorSections: ConfigSection[] = ['queues', 'advisor-stats', 'statuses', 'general'];
  const isSupervisor = user?.role === 'supervisor';

  // Función helper para verificar si una sección debe mostrarse
  const shouldShowSection = (section: ConfigSection): boolean => {
    if (!isSupervisor) return true; // Admin ve todo
    return supervisorSections.includes(section);
  };

  return (
    <div className="flex h-full overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl">
      {/* Sidebar Navigation */}
      <div className="flex w-64 flex-col border-r border-slate-200 bg-gradient-to-br from-slate-50 to-white">
        <div className="border-b border-slate-200 px-6 py-5">
          <h2 className="text-xl font-bold text-slate-900">⚙️ Configuración</h2>
          <p className="mt-1 text-xs text-slate-500">Panel de administración</p>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {shouldShowSection("users") && (
            <button
              onClick={() => setActiveSection("users")}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
                activeSection === "users"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                />
              </svg>
              Usuarios
            </button>
          )}

          {shouldShowSection("roles") && (
            <button
              onClick={() => setActiveSection("roles")}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
                activeSection === "roles"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
              Roles y Permisos
            </button>
          )}

          <button
            onClick={() => setActiveSection("queues")}
            className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
              activeSection === "queues"
                ? "bg-emerald-100 text-emerald-700"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            Colas de Atención
          </button>

          <button
            onClick={() => setActiveSection("advisor-stats")}
            className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
              activeSection === "advisor-stats"
                ? "bg-emerald-100 text-emerald-700"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
              />
            </svg>
            Monitoreo de Asesores
          </button>

          {shouldShowSection("crm-fields") && (
            <button
              onClick={() => setActiveSection("crm-fields")}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
                activeSection === "crm-fields"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"
                />
              </svg>
              Campos CRM
            </button>
          )}

          {shouldShowSection("whatsapp") && (
            <button
              onClick={() => setActiveSection("whatsapp")}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
                activeSection === "whatsapp"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"
                />
              </svg>
              WhatsApp Business
            </button>
          )}

          {shouldShowSection("bitrix24") && (
            <button
              onClick={() => setActiveSection("bitrix24")}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
                activeSection === "bitrix24"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              Bitrix24 CRM
            </button>
          )}

          {shouldShowSection("social-channels") && (
            <button
              onClick={() => setActiveSection("social-channels")}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
                activeSection === "social-channels"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z"
                />
              </svg>
              Canales Sociales
            </button>
          )}

          {shouldShowSection("ai") && (
            <button
              onClick={() => setActiveSection("ai")}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
                activeSection === "ai"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              Inteligencia Artificial
            </button>
          )}

          {shouldShowSection("ia-agent") && (
            <button
              onClick={() => setActiveSection("ia-agent")}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
                activeSection === "ia-agent"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
              Agente IA (Azaleia)
            </button>
          )}

          <button
            onClick={() => setActiveSection("statuses")}
            className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
              activeSection === "statuses"
                ? "bg-emerald-100 text-emerald-700"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            Estados de Asesor
          </button>

          {shouldShowSection("bot") && (
            <button
              onClick={() => setActiveSection("bot")}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
                activeSection === "bot"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              Timeout del Bot
            </button>
          )}

          <button
            onClick={() => setActiveSection("general")}
            className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
              activeSection === "general"
                ? "bg-emerald-100 text-emerald-700"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
            General
          </button>

          {shouldShowSection("maintenance") && (
            <button
              onClick={() => setActiveSection("maintenance")}
              className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition ${
                activeSection === "maintenance"
                  ? "bg-emerald-100 text-emerald-700"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              Alertas de Mantenimiento
            </button>
          )}
        </nav>

        <div className="border-t border-slate-200 p-4">
          <div className="rounded-lg bg-blue-50 p-3">
            <p className="text-xs font-semibold text-blue-700">💡 Ayuda</p>
            <p className="mt-1 text-xs text-blue-600">
              Gestiona usuarios, roles, colas y configuraciones del sistema.
            </p>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto bg-slate-50">
        {activeSection === "users" && <UserManagement />}
        {activeSection === "roles" && <RoleManagement />}
        {activeSection === "queues" && <QueueManagement />}
        {activeSection === "advisor-stats" && <AdvisorStats />}
        {activeSection === "crm-fields" && <CRMFieldConfig />}
        {activeSection === "whatsapp" && (
          <div className="p-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-900">WhatsApp Business</h2>
              <p className="mt-2 text-sm text-slate-600">
                Configura las conexiones de WhatsApp Business y gestiona los números disponibles.
              </p>
            </div>

            {/* Sub-tabs for WhatsApp */}
            <div className="mb-6 border-b border-slate-200">
              <div className="flex gap-4">
                <button
                  onClick={() => setWhatsappSubSection('connections')}
                  className={`pb-3 px-1 font-medium text-sm border-b-2 transition ${
                    whatsappSubSection === 'connections'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Conexión API
                </button>
                <button
                  onClick={() => setWhatsappSubSection('numbers')}
                  className={`pb-3 px-1 font-medium text-sm border-b-2 transition ${
                    whatsappSubSection === 'numbers'
                      ? 'border-emerald-600 text-emerald-700'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  Números & Colas
                </button>
              </div>
            </div>

            {whatsappSubSection === 'connections' && (
              <WhatsAppConfigContent
                whatsappNumbers={whatsappNumbers}
                onUpdateWhatsappNumbers={onUpdateWhatsappNumbers}
              />
            )}
            {whatsappSubSection === 'numbers' && <WhatsAppNumbersPanel />}
          </div>
        )}
        {activeSection === "bitrix24" && (
          <div className="p-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-900">Bitrix24 CRM</h2>
              <p className="mt-2 text-sm text-slate-600">
                Conecta y configura la integración con Bitrix24.
              </p>
            </div>
            <Bitrix24Panel />
          </div>
        )}
        {activeSection === "social-channels" && <SocialChannelsPanel />}
        {activeSection === "ai" && (
          <div className="p-6">
            <AIConfig />
          </div>
        )}
        {activeSection === "ia-agent" && (
          <div>
            <IAAgentConfig />
          </div>
        )}
        {activeSection === "statuses" && <StatusManagement />}
        {activeSection === "bot" && <BotConfig />}
        {activeSection === "general" && <GeneralSettings user={user} />}
        {activeSection === "maintenance" && (
          <div className="p-6">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-slate-900">⚠️ Alertas de Mantenimiento</h2>
              <p className="mt-2 text-sm text-slate-600">
                Gestiona las alertas de mantenimiento que los asesores ven en tiempo real.
              </p>
            </div>
            <MaintenanceControlPanel isAdmin={true} />
          </div>
        )}
      </div>
    </div>
  );
}
