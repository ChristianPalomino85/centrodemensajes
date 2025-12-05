/**
 * IA Agent Configuration Routes
 * API endpoints for managing the IA Agent configuration
 */

import { Router } from "express";
import { promises as fs } from "fs";
import path from "path";
import { requireAuth } from "../auth/middleware";

const router = Router();
const CONFIG_FILE = path.join(process.cwd(), "data", "ia-agent-config.json");
const PROMPT_FILE = path.join(process.cwd(), "data", "system-prompt-final.txt");

// Default configuration
const DEFAULT_CONFIG = {
  enabled: false,
  agentName: "Asistente Virtual",
  model: "gpt-4-turbo-preview",
  temperature: 0.7,
  maxTokens: 1000,
  personality: {
    tone: "amigable",
    emojiUsage: "moderado",
    region: "peru",
    presentsAs: "asistente_virtual",
  },
  systemPrompt: "Eres un asistente virtual útil y amigable.",
  catalogs: {},
  catalogBehavior: {
    sendMode: "ask_user",
    groupedSending: true,
    delayBetweenFiles: 0,
  },
  transferRules: {
    sales: {
      queueId: "",
      queueName: "",
      keywords: [],
      message: "",
      enabled: false,
      schedule: {
        days: [1, 2, 3, 4, 5, 6],
        startTime: "09:00",
        endTime: "18:00",
        timezone: "America/Lima",
      },
    },
    support: {
      queueId: "",
      queueName: "",
      keywords: [],
      message: "",
      enabled: false,
      schedule: {
        days: [1, 2, 3, 4, 5],
        startTime: "09:00",
        endTime: "18:00",
        timezone: "America/Lima",
      },
    },
  },
  leadQualification: {
    enabled: true,
    questions: {
      askName: true,
      askLocation: true,
      askBusinessType: true,
      askQuantity: true,
      askBudget: false,
    },
  },
  businessHours: {
    timezone: "America/Lima",
    defaultSchedule: {
      days: [1, 2, 3, 4, 5, 6],
      startTime: "09:00",
      endTime: "18:00",
    },
    outOfHoursMessage: "",
    outOfHoursBehavior: "offer_catalogs",
  },
  advancedSettings: {
    messageGrouping: {
      enabled: true,
      timeoutSeconds: 2.5,
    },
    conversationMemory: {
      enabled: true,
      maxMessages: 10,
      saveToBitrix: true,
      rememberPreviousConversations: true,
    },
    sentimentDetection: {
      enabled: true,
      onFrustratedAction: "transfer_supervisor",
    },
    maxInteractionsBeforeSuggestHuman: 5,
    fallbackResponse: "Déjame conectarte con un especialista.",
  },
  integrations: {
    bitrix24: {
      enabled: true,
      autoCreateContact: true,
      updateContactInfo: true,
      logInteractions: true,
      fieldsToSave: {
        name: true,
        phone: true,
        location: true,
        businessType: true,
        interest: true,
        catalogsDownloaded: true,
      },
    },
    knowledgeBase: {
      enabled: false,
      documents: [],
    },
  },
  version: "1.0.0",
  lastUpdated: new Date().toISOString(),
};

/**
 * Read system prompt from external TOON file
 */
async function readSystemPrompt(): Promise<string> {
  try {
    return await fs.readFile(PROMPT_FILE, "utf-8");
  } catch (error) {
    console.error("Error reading system prompt file:", error);
    return "Eres un asistente virtual útil.";
  }
}

/**
 * Write system prompt to external TOON file
 */
async function writeSystemPrompt(prompt: string): Promise<void> {
  await fs.writeFile(PROMPT_FILE, prompt, "utf-8");
}

/**
 * Read IA Agent configuration
 * Loads systemPrompt from external TOON file for display
 */
async function readConfig(): Promise<any> {
  try {
    const data = await fs.readFile(CONFIG_FILE, "utf-8");
    const config = JSON.parse(data);

    // Prefer systemPrompt from JSON; fallback to external file (TOON format)
    if (!config.systemPrompt || typeof config.systemPrompt !== 'string' || !config.systemPrompt.trim()) {
      config.systemPrompt = await readSystemPrompt();
    }

    return config;
  } catch (error) {
    // If file doesn't exist, return default config
    const defaultConfig = { ...DEFAULT_CONFIG };
    defaultConfig.systemPrompt = await readSystemPrompt();
    return defaultConfig;
  }
}

/**
 * Convert promotions text to TOON format
 */
function formatPromotionsToTOON(promotions: string): string {
  if (!promotions || promotions.trim() === '') {
    return '';
  }

  const lines = promotions.trim().split('\n').filter(line => line.trim());
  let toon = '\n# 🎉 PROMOCIONES VIGENTES\n\n';

  for (const line of lines) {
    const cleanLine = line.trim().replace(/^[-•*]\s*/, '');
    if (cleanLine) {
      toon += `- ${cleanLine}\n`;
    }
  }

  toon += '\n⚠️ Menciona estas promociones cuando el cliente pregunte por ofertas, descuentos o promociones.\n';

  return toon;
}

/**
 * Inject promotions into system prompt
 */
function injectPromotionsIntoPrompt(systemPrompt: string, promotions: string): string {
  // Remove existing promotions section if present
  const cleanPrompt = systemPrompt.replace(/\n# 🎉 PROMOCIONES VIGENTES[\s\S]*?(?=\n# |$)/g, '');

  // If no promotions, return clean prompt
  if (!promotions || promotions.trim() === '') {
    return cleanPrompt;
  }

  // Format promotions to TOON
  const promotionsTOON = formatPromotionsToTOON(promotions);

  // Find best insertion point (after "DATOS EMPRESA" or at the end)
  const insertPoint = cleanPrompt.indexOf('\n# PRODUCTOS');
  if (insertPoint !== -1) {
    return cleanPrompt.slice(0, insertPoint) + promotionsTOON + cleanPrompt.slice(insertPoint);
  }

  // Fallback: append at the end
  return cleanPrompt + promotionsTOON;
}

/**
 * Write IA Agent configuration
 * Saves systemPrompt to external TOON file (not in JSON)
 * Integrates currentPromotions into the prompt in TOON format
 */
async function writeConfig(config: any): Promise<void> {
  config.lastUpdated = new Date().toISOString();

  // Extract and save systemPrompt to external file
  if (config.systemPrompt) {
    // If there are promotions, inject them into the prompt
    let finalPrompt = config.systemPrompt;
    if (config.currentPromotions) {
      finalPrompt = injectPromotionsIntoPrompt(config.systemPrompt, config.currentPromotions);
      console.log('[IAAgentConfig] Promotions injected into system prompt');
    }

    await writeSystemPrompt(finalPrompt);
    // Keep prompt in JSON too so panel refleja cambios
    config.systemPrompt = finalPrompt;
  }

  // Keep currentPromotions in JSON for display in panel
  // (it's already in config, no need to delete it)

  await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
}

/**
 * GET /api/ia-agent-config
 * Get current IA Agent configuration
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const config = await readConfig();
    res.json(config);
  } catch (error) {
    console.error("Error reading IA Agent config:", error);
    res.status(500).json({ error: "Failed to read configuration" });
  }
});

/**
 * PUT /api/ia-agent-config
 * Update IA Agent configuration
 */
router.put("/", requireAuth, async (req, res) => {
  try {
    const newConfig = req.body;

    // Validate required fields
    if (!newConfig.agentName || !newConfig.model || !newConfig.systemPrompt) {
      return res.status(400).json({
        error: "Missing required fields: agentName, model, systemPrompt"
      });
    }

    await writeConfig(newConfig);
    res.json({ success: true, config: newConfig });
  } catch (error) {
    console.error("Error writing IA Agent config:", error);
    res.status(500).json({ error: "Failed to write configuration" });
  }
});

/**
 * PATCH /api/ia-agent-config/enabled
 * Toggle agent enabled/disabled
 */
router.patch("/enabled", requireAuth, async (req, res) => {
  try {
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }

    const config = await readConfig();
    config.enabled = enabled;
    await writeConfig(config);

    res.json({ success: true, enabled });
  } catch (error) {
    console.error("Error toggling IA Agent:", error);
    res.status(500).json({ error: "Failed to toggle agent" });
  }
});

/**
 * POST /api/ia-agent-config/reset
 * Reset configuration to defaults
 */
router.post("/reset", requireAuth, async (req, res) => {
  try {
    await writeConfig(DEFAULT_CONFIG);
    res.json({ success: true, config: DEFAULT_CONFIG });
  } catch (error) {
    console.error("Error resetting IA Agent config:", error);
    res.status(500).json({ error: "Failed to reset configuration" });
  }
});

export default router;
export { readConfig, writeConfig };
