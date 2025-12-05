import fs from "fs";
import { getSecretsPath, readJsonFile } from "./storage";
import { decryptObject } from "./encryption";

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export interface WhatsAppEnvConfig {
  baseUrl: string;
  apiVersion: string;
  phoneNumberId?: string;
  displayNumber?: string;
  accessToken?: string;
  verifyToken?: string;
}

interface WhatsAppSecrets {
  phoneNumberId?: string;
  displayNumber?: string;
  accessToken?: string;
  verifyToken?: string;
}

export interface BitrixEnvConfig {
  webhookUrl?: string;
  portal?: string;
}

const WHATSAPP_SECRET_PATH = getSecretsPath("whatsapp.json");

function readWhatsAppSecrets(): WhatsAppSecrets {
  return readJsonFile<WhatsAppSecrets>(WHATSAPP_SECRET_PATH) ?? {};
}

export function getWhatsAppEnv(): WhatsAppEnvConfig {
  const baseUrl =
    readEnv("WSP_BASE_URL") ?? readEnv("WHATSAPP_API_BASE_URL") ?? "https://graph.facebook.com";
  const apiVersion =
    readEnv("WSP_API_VERSION") ?? readEnv("WHATSAPP_API_VERSION") ?? "v20.0";
  const secrets = readWhatsAppSecrets();
  const phoneNumberId = readEnv("WSP_PHONE_NUMBER_ID") ?? readEnv("WHATSAPP_PHONE_NUMBER_ID") ?? secrets.phoneNumberId;
  const accessToken = readEnv("WSP_ACCESS_TOKEN") ?? readEnv("WHATSAPP_ACCESS_TOKEN") ?? secrets.accessToken;
  const verifyToken = readEnv("WSP_VERIFY_TOKEN") ?? readEnv("WHATSAPP_VERIFY_TOKEN") ?? secrets.verifyToken;
  const displayNumber = secrets.displayNumber;

  return { baseUrl, apiVersion, phoneNumberId, displayNumber, accessToken, verifyToken };
}

export function isWhatsAppConfigured(): boolean {
  const env = getWhatsAppEnv();
  return Boolean(env.phoneNumberId && env.accessToken);
}

const BITRIX_TOKEN_PATH = getSecretsPath("bitrix-tokens.json");

interface BitrixStoredTokens {
  access_token?: string;
  refresh_token?: string;
  domain?: string;
  member_id?: string;
  expires?: number;
}

function readBitrixTokenFile(): BitrixStoredTokens | null {
  try {
    if (!fs.existsSync(BITRIX_TOKEN_PATH)) {
      return null;
    }
    const raw = fs.readFileSync(BITRIX_TOKEN_PATH, "utf8");
    const parsed = JSON.parse(raw) as BitrixStoredTokens;

    // Decrypt sensitive fields
    const sensitiveFields: (keyof BitrixStoredTokens)[] = ['access_token', 'refresh_token'];
    return decryptObject(parsed, sensitiveFields);
  } catch (error) {
    console.warn("[Bitrix] No se pudo leer bitrix-tokens.json", error);
    return null;
  }
}

export function getBitrixEnv(): BitrixEnvConfig {
  const webhookUrl = readEnv("BITRIX24_WEBHOOK_URL");
  const tokens = readBitrixTokenFile();
  const portal = tokens?.domain ?? (webhookUrl ? new URL(webhookUrl).hostname : undefined);
  return { webhookUrl, portal };
}

/**
 * Obtiene la configuración de Bitrix24 para el cliente
 * Prioriza OAuth sobre webhook si ambos están disponibles
 */
export function getBitrixClientConfig(): { domain?: string; accessToken?: string; webhookUrl?: string } | null {
  const tokens = readBitrixTokenFile();

  // Preferir OAuth si está disponible
  if (tokens?.access_token && tokens?.domain) {
    return {
      domain: tokens.domain,
      accessToken: tokens.access_token,
    };
  }

  // Fallback a webhook si está configurado
  const webhookUrl = readEnv("BITRIX24_WEBHOOK_URL");
  if (webhookUrl) {
    return { webhookUrl };
  }

  return null;
}

export function getWhatsAppVerifyToken(): string {
  return getWhatsAppEnv().verifyToken ?? "";
}
