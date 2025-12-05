import { useState, useEffect } from "react";
import { X, Send, CheckCircle, XCircle, Loader } from "lucide-react";
import { apiUrl } from "../lib/apiBase";

interface BitrixContact {
  ID: string;
  NAME?: string;
  LAST_NAME?: string;
  PHONE?: Array<{ VALUE: string; VALUE_TYPE?: string }>;
  UF_CRM_1753421555?: string; // Autoriza Publicidad (Contacto)
  UF_CRM_1749101575?: string; // Autoriza Publicidad (Lead)
  [key: string]: any;
}

interface WhatsAppTemplate {
  name: string;
  language: string;
  status: string;
  category: string;
  components?: any[];
}

interface WhatsAppConnection {
  id: string;
  alias: string;
  phoneNumberId: string;
  displayNumber: string;
  isActive: boolean;
}

interface SendTemplateModalProps {
  contact: BitrixContact;
  onClose: () => void;
}

export function SendTemplateModal({ contact, onClose }: SendTemplateModalProps) {
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [connections, setConnections] = useState<WhatsAppConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);
  const [selectedTemplateObj, setSelectedTemplateObj] = useState<WhatsAppTemplate | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("es");
  const [selectedConnection, setSelectedConnection] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<"idle" | "success" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");

  // Template parameters
  const [bodyParams, setBodyParams] = useState<Record<string, string>>({});
  const [headerImageUrl, setHeaderImageUrl] = useState<string | null>(null);
  const [requiresHeaderImage, setRequiresHeaderImage] = useState<boolean>(false);
  const [uploadingImage, setUploadingImage] = useState<boolean>(false);
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [savedImages, setSavedImages] = useState<Array<{ filename: string; url: string; uploadedAt: number }>>([]);
  const [loadingImages, setLoadingImages] = useState(false);

  // Cargar imágenes guardadas del servidor al inicio
  useEffect(() => {
    fetchSavedImages();
  }, []);

  // Auto-seleccionar la primera imagen guardada si existe y no hay imagen seleccionada
  useEffect(() => {
    if (requiresHeaderImage && !headerImageUrl && savedImages.length > 0) {
      const firstImage = savedImages[0];
      const baseUrl = window.location.origin;
      setHeaderImageUrl(`${baseUrl}${firstImage.url}`);
      console.log('[AutoSelect] Using first saved image:', firstImage.filename);
    }
  }, [requiresHeaderImage, savedImages, headerImageUrl]);

  const fetchSavedImages = async () => {
    try {
      setLoadingImages(true);
      const response = await fetch(apiUrl("/api/template-images"), {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setSavedImages(data.images || []);
      }
    } catch (error) {
      console.error("[SavedImages] Error loading:", error);
    } finally {
      setLoadingImages(false);
    }
  };

  // Priorizar teléfono de trabajo (WORK) igual que en la tabla
  const getPhone = () => {
    if (!contact.PHONE || contact.PHONE.length === 0) return "";

    // Priorizar teléfono de trabajo (WORK)
    const workPhone = contact.PHONE.find(p => p.VALUE_TYPE === "WORK");
    if (workPhone) return workPhone.VALUE;

    // Si no hay WORK, buscar MOBILE
    const mobilePhone = contact.PHONE.find(p => p.VALUE_TYPE === "MOBILE");
    if (mobilePhone) return mobilePhone.VALUE;

    // Si no hay ninguno, usar el primero disponible
    return contact.PHONE[0]?.VALUE || "";
  };

  const phone = getPhone();
  const contactName = [contact.NAME, contact.LAST_NAME].filter(Boolean).join(" ") || "Sin nombre";

  // Helper para obtener el badge de autoriza publicidad
  const getPublicidadBadge = () => {
    const value = contact.UF_CRM_1753421555 || contact.UF_CRM_1749101575;
    const siIds = ["96420", "96130"];
    const noIds = ["96422", "96132"];

    if (siIds.includes(String(value))) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-400/30 text-white text-xs font-medium border border-emerald-300/40" title="Autoriza publicidad">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
          Publicidad
        </span>
      );
    } else if (noIds.includes(String(value))) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-400/30 text-white text-xs font-medium border border-red-300/40" title="No autoriza publicidad">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
          No Publicidad
        </span>
      );
    } else {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-400/30 text-white text-xs font-medium border border-amber-300/40" title="Por confirmar">
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
          ?
        </span>
      );
    }
  };

  // Detect template components and extract parameters
  const analyzeTemplate = (template: WhatsAppTemplate) => {
    // Reset parameters
    setBodyParams({});
    setHeaderImageUrl(null);
    setRequiresHeaderImage(false);

    // Extract BODY parameters
    const bodyComponent = template.components?.find((c) => c.type === "BODY");
    if (bodyComponent?.text) {
      const matches = bodyComponent.text.match(/\{\{(\d+)\}\}/g);
      if (matches) {
        const params: Record<string, string> = {};
        matches.forEach((match: string) => {
          const num = match.replace(/[{}]/g, "");
          params[num] = "";
        });
        setBodyParams(params);
      }
    }

    // Check if HEADER has IMAGE format with parameters
    const headerComponent = template.components?.find((c) => c.type === "HEADER");
    if (headerComponent?.format === "IMAGE") {
      // Verificar si tiene parámetros (ejemplo: {{1}})
      const hasParameters = headerComponent.example?.header_handle?.length > 0;
      if (hasParameters) {
        // Plantilla con imagen VARIABLE - requiere URL
        setRequiresHeaderImage(true);

        // CARGAR AUTOMÁTICAMENTE la primera imagen guardada
        // Se cargará automáticamente cuando fetchSavedImages termine
        setRequiresHeaderImage(true);
        setHeaderImageUrl(""); // Se llenará automáticamente
      } else {
        // Plantilla con imagen FIJA - automática
        setRequiresHeaderImage(false);
        setHeaderImageUrl(null);
      }
    }
  };

  const handleSelectTemplate = (template: WhatsAppTemplate) => {
    setSelectedTemplate(template.name);
    setSelectedTemplateObj(template);
    setSelectedLanguage(template.language);
    analyzeTemplate(template);
    setSendStatus("idle");
    setErrorMessage("");
  };

  const handleImageFileSelect = async (file: File) => {
    if (!file || !selectedConnection) {
      setErrorMessage("Selecciona un número de WhatsApp primero");
      return;
    }

    // Validar tipo de archivo
    if (!file.type.startsWith('image/')) {
      setErrorMessage("Solo se permiten archivos de imagen (JPG, PNG, etc.)");
      return;
    }

    // Validar tamaño (máximo 5MB)
    if (file.size > 5 * 1024 * 1024) {
      setErrorMessage("La imagen no debe superar 5MB");
      return;
    }

    try {
      setUploadingImage(true);
      setErrorMessage("");
      setSelectedImageFile(file);

      // Subir imagen al servidor permanentemente
      const formData = new FormData();
      formData.append('image', file);

      const uploadResponse = await fetch(apiUrl("/api/template-images/upload"), {
        method: "POST",
        credentials: "include",
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error("Error al subir la imagen al servidor");
      }

      const uploadResult = await uploadResponse.json();

      // Usar la URL completa del servidor
      if (uploadResult.fullUrl) {
        setHeaderImageUrl(uploadResult.fullUrl);
      }

      console.log("[ImageUpload] Success:", uploadResult);

      // Recargar lista de imágenes guardadas
      await fetchSavedImages();
    } catch (error) {
      console.error("[ImageUpload] Error:", error);
      setErrorMessage(error instanceof Error ? error.message : "Error al subir la imagen");
      setSelectedImageFile(null);
      setHeaderImageUrl(null);
    } finally {
      setUploadingImage(false);
    }
  };

  const useSavedImage = (imageUrl: string) => {
    setHeaderImageUrl(imageUrl);
    setSelectedImageFile(null);
  };

  // Convertir link de Google Drive a formato de descarga directa
  const convertGoogleDriveUrl = (url: string): string => {
    // Patrón: https://drive.google.com/file/d/FILE_ID/view
    const match = url.match(/\/file\/d\/([^/]+)/);
    if (match && match[1]) {
      return `https://drive.google.com/uc?export=download&id=${match[1]}`;
    }
    return url;
  };

  const handleUrlChange = (url: string) => {
    const convertedUrl = convertGoogleDriveUrl(url);
    setHeaderImageUrl(convertedUrl);

    // Si es diferente, mostrar que se convirtió
    if (convertedUrl !== url && url.includes('drive.google.com')) {
      console.log('[GoogleDrive] Converted URL:', convertedUrl);
    }
  };

  useEffect(() => {
    fetchConnectionsAndTemplates();
  }, []);

  const fetchConnectionsAndTemplates = async () => {
    try {
      setLoading(true);

      // Fetch WhatsApp connections
      const connectionsResponse = await fetch(apiUrl("/api/connections/whatsapp/list"), {
        credentials: "include",
      });

      if (connectionsResponse.ok) {
        const connectionsData = await connectionsResponse.json();
        const availableConnections = connectionsData.connections || [];
        setConnections(availableConnections);

        // Auto-select first active connection
        const firstActive = availableConnections.find((c: WhatsAppConnection) => c.isActive);
        if (firstActive) {
          setSelectedConnection(firstActive.phoneNumberId);
        }
      }

      // Fetch templates
      const templatesResponse = await fetch(apiUrl("/api/crm/templates"), {
        credentials: "include",
      });

      if (!templatesResponse.ok) {
        throw new Error("Failed to fetch templates");
      }

      const templatesData = await templatesResponse.json();
      setTemplates(templatesData.templates || []);
    } catch (error) {
      console.error("Error fetching data:", error);
      setErrorMessage("Error al cargar plantillas");
    } finally {
      setLoading(false);
    }
  };

  const handleSendTemplate = async () => {
    if (!selectedTemplate || !phone || !selectedConnection) {
      console.error("[SendTemplate] Missing data:", { selectedTemplate, phone, selectedConnection, contact });
      setSendStatus("error");
      setErrorMessage("Faltan datos: teléfono, plantilla o número de WhatsApp");
      return;
    }

    try {
      setSending(true);
      setSendStatus("idle");
      setErrorMessage("");

      // Build components array if template has parameters
      const components: any[] = [];

      // Add HEADER component if it has an image AND user provided one
      // Si no se proporciona imagen, WhatsApp usará la imagen de ejemplo de la plantilla
      if (requiresHeaderImage && headerImageUrl && headerImageUrl.trim() !== "") {
        components.push({
          type: "header",
          parameters: [
            {
              type: "image",
              image: {
                link: headerImageUrl,
              },
            },
          ],
        });
      }

      // Add BODY component if it has parameters
      if (Object.keys(bodyParams).length > 0) {
        const hasAllValues = Object.values(bodyParams).every((v) => v.trim() !== "");
        if (hasAllValues) {
          components.push({
            type: "body",
            parameters: Object.keys(bodyParams)
              .sort((a, b) => Number(a) - Number(b))
              .map((key) => ({
                type: "text",
                text: bodyParams[key],
              })),
          });
        }
      }

      console.log("[SendTemplate] Sending to:", {
        phone,
        templateName: selectedTemplate,
        contactId: contact.ID,
        components: components.length > 0 ? components : undefined,
      });

      const response = await fetch(apiUrl("/api/crm/templates/send"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "include",
        body: JSON.stringify({
          phone,
          templateName: selectedTemplate,
          language: selectedLanguage,
          channelConnectionId: selectedConnection,
          components: components.length > 0 ? components : undefined,
        }),
      });

      console.log("[SendTemplate] Response status:", response.status);

      if (!response.ok) {
        let errorMsg = "Error al enviar plantilla";
        try {
          const error = await response.json();
          console.error("[SendTemplate] Server error:", error);

          // Check if it's a WhatsApp template error
          if (error.details?.error?.code === 132001) {
            errorMsg = `La plantilla "${selectedTemplate}" no existe o no está aprobada en el idioma "${selectedLanguage}". Verifica en WhatsApp Business Manager.`;
          } else if (error.details?.error?.code === 132012) {
            errorMsg = `La plantilla "${selectedTemplate}" requiere parámetros (variables o imágenes) que no se están enviando. Esta plantilla necesita ser enviada desde el módulo CRM con los parámetros completos.`;
          } else if (error.details?.error?.message) {
            errorMsg = error.details.error.message;
          } else {
            errorMsg = error.message || error.error || errorMsg;
          }
        } catch (e) {
          console.error("[SendTemplate] Could not parse error response");
        }
        throw new Error(errorMsg);
      }

      const result = await response.json();
      console.log("[SendTemplate] Success:", result);

      setSendStatus("success");
      setTimeout(() => {
        onClose();
      }, 2000);
    } catch (error) {
      console.error("[SendTemplate] Error:", error);
      setSendStatus("error");
      setErrorMessage(error instanceof Error ? error.message : "Error desconocido");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-emerald-500 to-emerald-600 px-6 py-5 text-white flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Send className="w-6 h-6" />
              Enviar Plantilla WhatsApp
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-emerald-100">{contactName} · {phone}</p>
              {getPublicidadBadge()}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-white/20 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-6">
          {!phone && (
            <div className="mb-4 p-3 rounded-lg bg-red-100 border border-red-300 flex items-center gap-2 text-red-800">
              <XCircle className="w-5 h-5" />
              <div className="flex-1">
                <p className="text-sm font-medium">Este contacto no tiene teléfono registrado</p>
                <p className="text-xs mt-1">Agrega un teléfono de trabajo en Bitrix24 para enviar plantillas</p>
              </div>
            </div>
          )}

          {/* WhatsApp Number Selector */}
          {connections.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Enviar desde el número:
              </label>
              <select
                value={selectedConnection || ""}
                onChange={(e) => setSelectedConnection(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border-2 border-slate-200 bg-white text-slate-800 font-medium focus:border-emerald-500 focus:outline-none transition-colors"
              >
                {connections.map((conn) => (
                  <option key={conn.id} value={conn.phoneNumberId}>
                    {conn.alias} ({conn.displayNumber})
                  </option>
                ))}
              </select>
            </div>
          )}

          {loading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader className="w-8 h-8 text-emerald-500 animate-spin mb-3" />
              <p className="text-slate-600">Cargando plantillas...</p>
            </div>
          ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mb-4">
                <XCircle className="w-8 h-8 text-slate-400" />
              </div>
              <p className="text-lg text-slate-600 mb-2">No hay plantillas disponibles</p>
              <p className="text-sm text-slate-500">
                Configura plantillas en tu cuenta de WhatsApp Business
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700 mb-4">
                Selecciona una plantilla para enviar:
              </p>
              {templates
                .filter((t) => t.status === "APPROVED")
                .map((template) => (
                  <button
                    key={template.name}
                    onClick={() => handleSelectTemplate(template)}
                    className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                      selectedTemplate === template.name
                        ? "border-emerald-500 bg-emerald-50 shadow-md"
                        : "border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/50"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <p className="font-semibold text-slate-800 mb-1">{template.name}</p>
                        <div className="flex items-center gap-3 text-xs text-slate-500">
                          <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                            {template.category}
                          </span>
                          <span>Idioma: {template.language}</span>
                        </div>
                        {template.components && template.components.length > 0 && (
                          <div className="mt-2 text-xs text-slate-600 bg-slate-50 rounded-lg p-2">
                            {template.components
                              .filter((c) => c.type === "BODY")
                              .map((c, idx) => (
                                <p key={idx} className="line-clamp-2">{c.text}</p>
                              ))}
                          </div>
                        )}
                      </div>
                      {selectedTemplate === template.name && (
                        <div className="ml-3">
                          <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center">
                            <CheckCircle className="w-4 h-4 text-white" />
                          </div>
                        </div>
                      )}
                    </div>
                  </button>
                ))}

              {/* Template Parameters Section */}
              {selectedTemplateObj && (Object.keys(bodyParams).length > 0 || requiresHeaderImage) && (
                <div className="mt-6 p-4 border-2 border-emerald-200 rounded-xl bg-emerald-50/30">
                  <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs">!</span>
                    Parámetros de la plantilla "{selectedTemplateObj.name}"
                  </h4>

                  {/* Header Image Input */}
                  {requiresHeaderImage && (
                    <div className="mb-4">
                      {/* Mostrar estado de carga automática */}
                      {headerImageUrl && savedImages.length > 0 ? (
                        <div className="p-3 bg-emerald-50 border border-emerald-300 rounded-lg mb-3">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">✅</span>
                            <div className="flex-1">
                              <h4 className="font-bold text-emerald-800 text-sm">Imagen cargada automáticamente</h4>
                              <p className="text-xs text-emerald-700 mt-0.5">
                                Usando tu imagen guardada - Solo da click en "Enviar Plantilla"
                              </p>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="p-3 bg-yellow-50 border border-yellow-300 rounded-lg mb-3">
                          <div className="flex items-start gap-2">
                            <span className="text-xl">⚠️</span>
                            <div>
                              <h4 className="font-bold text-slate-800 text-sm">Esta plantilla requiere una imagen</h4>
                              <p className="text-xs text-slate-600 mt-1">
                                Sube una imagen para enviar. Se guardará automáticamente para futuros envíos.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* File Upload Button */}
                      <div className="flex items-center gap-3">
                        <label className="flex-1 cursor-pointer">
                          <div className={`px-4 py-3 rounded-lg border-2 transition-all ${
                            uploadingImage
                              ? 'border-emerald-300 bg-emerald-50'
                              : 'border-slate-200 hover:border-emerald-400 bg-white'
                          } flex items-center justify-center gap-2`}>
                            {uploadingImage ? (
                              <>
                                <Loader className="w-5 h-5 animate-spin text-emerald-600" />
                                <span className="text-sm font-medium text-emerald-700">Subiendo imagen...</span>
                              </>
                            ) : selectedImageFile ? (
                              <>
                                <CheckCircle className="w-5 h-5 text-emerald-600" />
                                <span className="text-sm font-medium text-emerald-700">{selectedImageFile.name}</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-5 h-5 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                                </svg>
                                <span className="text-sm font-medium text-slate-700">Seleccionar imagen desde tu PC</span>
                              </>
                            )}
                          </div>
                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImageFileSelect(file);
                            }}
                            disabled={uploadingImage}
                          />
                        </label>
                      </div>

                      <p className="text-xs text-slate-600 mt-2 font-medium">
                        {selectedImageFile
                          ? `✅ Imagen seleccionada: ${selectedImageFile.name} (${(selectedImageFile.size / 1024).toFixed(1)} KB)`
                          : headerImageUrl
                          ? `✅ Usando imagen guardada`
                          : '👆 Haz click arriba para seleccionar la imagen desde tu PC'
                        }
                      </p>


                      {/* Campo para pegar URL de Google Drive */}
                      <div className="mt-3 pt-3 border-t border-slate-200">
                        <label className="block text-xs font-medium text-slate-700 mb-2">
                          O pega un link de Google Drive / URL directa:
                        </label>
                        <input
                          type="text"
                          value={headerImageUrl || ""}
                          onChange={(e) => handleUrlChange(e.target.value)}
                          placeholder="https://drive.google.com/file/d/..."
                          className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 focus:border-emerald-500 focus:outline-none transition-colors text-sm"
                        />
                        <p className="text-xs text-slate-500 mt-1">
                          💡 Puedes pegar links de Google Drive directamente - se convertirán automáticamente
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Body Parameters */}
                  {Object.keys(bodyParams).length > 0 && (
                    <div className="space-y-3">
                      {Object.keys(bodyParams)
                        .sort((a, b) => Number(a) - Number(b))
                        .map((key) => (
                          <div key={key}>
                            <label className="block text-sm font-medium text-slate-700 mb-2">
                              Parámetro {key} {"{{" + key + "}}"}
                            </label>
                            <input
                              type="text"
                              value={bodyParams[key]}
                              onChange={(e) =>
                                setBodyParams((prev) => ({ ...prev, [key]: e.target.value }))
                              }
                              placeholder={`Valor para el parámetro ${key}`}
                              className="w-full px-3 py-2 rounded-lg border-2 border-slate-200 focus:border-emerald-500 focus:outline-none transition-colors"
                            />
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-slate-200 px-6 py-4 bg-slate-50">
          {sendStatus === "success" && (
            <div className="mb-4 p-3 rounded-lg bg-emerald-100 border border-emerald-300 flex items-center gap-2 text-emerald-800">
              <CheckCircle className="w-5 h-5" />
              <p className="text-sm font-medium">¡Plantilla enviada exitosamente!</p>
            </div>
          )}
          {sendStatus === "error" && (
            <div className="mb-4 p-3 rounded-lg bg-red-100 border border-red-300 flex items-center gap-2 text-red-800">
              <XCircle className="w-5 h-5" />
              <div className="flex-1">
                <p className="text-sm font-medium">Error al enviar plantilla</p>
                {errorMessage && <p className="text-xs mt-1">{errorMessage}</p>}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border-2 border-slate-300 text-slate-700 font-medium hover:bg-slate-100 transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSendTemplate}
              disabled={
                !selectedTemplate ||
                sending ||
                !phone ||
                !selectedConnection ||
                (Object.keys(bodyParams).length > 0 && Object.values(bodyParams).some((v) => !v.trim())) ||
                (requiresHeaderImage && (!headerImageUrl || headerImageUrl.trim() === ""))
              }
              className="flex-1 px-4 py-2.5 rounded-lg bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-medium hover:from-emerald-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm hover:shadow-md flex items-center justify-center gap-2"
            >
              {sending ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Enviando...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5" />
                  Enviar Plantilla
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
