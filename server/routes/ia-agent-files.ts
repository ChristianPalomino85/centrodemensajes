/**
 * IA Agent Files Management Routes
 * API endpoints for managing agent files (catalogs, flyers, documents)
 */
import { Router } from "express";
import { promises as fs } from "fs";
import path from "path";
import { requireAuth } from "../auth/middleware";
import { randomUUID } from "crypto";

const router = Router();
const FILES_CONFIG_PATH = path.join(process.cwd(), "data", "ia-agent-files.json");

// File categories
export type FileCategory = 'catalog' | 'flyer' | 'info' | 'other';

export interface AgentFile {
  id: string;
  name: string;
  description: string;
  category: FileCategory;
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
  tags: string[];
  metadata: {
    brand?: string;
    withPrices?: boolean;
    season?: string;
    year?: string;
    [key: string]: any;
  };
  enabled: boolean;
  priority: number; // 1 = highest (current/active catalogs), 2 = normal, 3 = low (old/archive)
  isCurrentCatalog: boolean; // Flag for current/active catalogs that should be searched first
  createdAt: string;
  updatedAt: string;
}

export interface AgentFilesConfig {
  files: AgentFile[];
  version: string;
  lastUpdated: string;
}

// Initialize files config
async function initFilesConfig(): Promise<void> {
  try {
    await fs.access(FILES_CONFIG_PATH);
  } catch {
    const initialConfig: AgentFilesConfig = {
      files: [],
      version: "1.0.0",
      lastUpdated: new Date().toISOString()
    };
    await fs.writeFile(FILES_CONFIG_PATH, JSON.stringify(initialConfig, null, 2));
  }
}

// Read files config
async function readFilesConfig(): Promise<AgentFilesConfig> {
  await initFilesConfig();
  const data = await fs.readFile(FILES_CONFIG_PATH, "utf-8");
  return JSON.parse(data);
}

// Write files config
async function writeFilesConfig(config: AgentFilesConfig): Promise<void> {
  config.lastUpdated = new Date().toISOString();
  await fs.writeFile(FILES_CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * GET /api/ia-agent-files
 * Get all agent files
 */
router.get("/", requireAuth, async (req, res) => {
  try {
    const config = await readFilesConfig();

    // Filter by category if provided
    const category = req.query.category as FileCategory | undefined;
    const enabledOnly = req.query.enabled === 'true';

    let files = config.files;

    if (category) {
      files = files.filter(f => f.category === category);
    }

    if (enabledOnly) {
      files = files.filter(f => f.enabled);
    }

    res.json({ files, version: config.version });
  } catch (error) {
    console.error("[IA Agent Files] Error reading files:", error);
    res.status(500).json({ error: "Failed to read files" });
  }
});

/**
 * GET /api/ia-agent-files/:id
 * Get a specific file
 */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const config = await readFilesConfig();
    const file = config.files.find(f => f.id === req.params.id);

    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    res.json(file);
  } catch (error) {
    console.error("[IA Agent Files] Error reading file:", error);
    res.status(500).json({ error: "Failed to read file" });
  }
});

/**
 * POST /api/ia-agent-files
 * Create a new file entry
 */
router.post("/", requireAuth, async (req, res) => {
  try {
    const { name, description, category, url, fileName, mimeType, size, tags, metadata, enabled } = req.body;

    // Validate required fields
    if (!name || !category || !url || !fileName) {
      res.status(400).json({ error: "Missing required fields: name, category, url, fileName" });
      return;
    }

    const config = await readFilesConfig();

    const newFile: AgentFile = {
      id: randomUUID(),
      name,
      description: description || '',
      category,
      url,
      fileName,
      mimeType: mimeType || 'application/pdf',
      size: size || 0,
      tags: tags || [],
      metadata: metadata || {},
      enabled: enabled !== false, // Default to true
      priority: req.body.priority || 2, // Default to normal priority
      isCurrentCatalog: req.body.isCurrentCatalog || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    config.files.push(newFile);
    await writeFilesConfig(config);

    console.log(`[IA Agent Files] Created file: ${newFile.name} (${newFile.id}) - Priority: ${newFile.priority}, Current: ${newFile.isCurrentCatalog}`);
    res.json(newFile);
  } catch (error) {
    console.error("[IA Agent Files] Error creating file:", error);
    res.status(500).json({ error: "Failed to create file" });
  }
});

/**
 * PUT /api/ia-agent-files/:id
 * Update a file entry
 */
router.put("/:id", requireAuth, async (req, res) => {
  try {
    const config = await readFilesConfig();
    const fileIndex = config.files.findIndex(f => f.id === req.params.id);

    if (fileIndex === -1) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const existingFile = config.files[fileIndex];

    // Update fields
    const updatedFile: AgentFile = {
      ...existingFile,
      ...req.body,
      id: existingFile.id, // Preserve ID
      createdAt: existingFile.createdAt, // Preserve creation date
      updatedAt: new Date().toISOString()
    };

    config.files[fileIndex] = updatedFile;
    await writeFilesConfig(config);

    console.log(`[IA Agent Files] Updated file: ${updatedFile.name} (${updatedFile.id})`);
    res.json(updatedFile);
  } catch (error) {
    console.error("[IA Agent Files] Error updating file:", error);
    res.status(500).json({ error: "Failed to update file" });
  }
});

/**
 * DELETE /api/ia-agent-files/:id
 * Delete a file entry
 */
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const config = await readFilesConfig();
    const fileIndex = config.files.findIndex(f => f.id === req.params.id);

    if (fileIndex === -1) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const deletedFile = config.files[fileIndex];
    config.files.splice(fileIndex, 1);
    await writeFilesConfig(config);

    console.log(`[IA Agent Files] Deleted file: ${deletedFile.name} (${deletedFile.id})`);
    res.json({ success: true, file: deletedFile });
  } catch (error) {
    console.error("[IA Agent Files] Error deleting file:", error);
    res.status(500).json({ error: "Failed to delete file" });
  }
});

/**
 * POST /api/ia-agent-files/:id/toggle
 * Toggle file enabled/disabled
 */
router.post("/:id/toggle", requireAuth, async (req, res) => {
  try {
    const config = await readFilesConfig();
    const file = config.files.find(f => f.id === req.params.id);

    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    file.enabled = !file.enabled;
    file.updatedAt = new Date().toISOString();
    await writeFilesConfig(config);

    console.log(`[IA Agent Files] Toggled file: ${file.name} - ${file.enabled ? 'enabled' : 'disabled'}`);
    res.json(file);
  } catch (error) {
    console.error("[IA Agent Files] Error toggling file:", error);
    res.status(500).json({ error: "Failed to toggle file" });
  }
});

/**
 * POST /api/ia-agent-files/batch
 * Create multiple file entries at once
 */
router.post("/batch", requireAuth, async (req, res) => {
  try {
    const { files: newFiles } = req.body;

    if (!Array.isArray(newFiles) || newFiles.length === 0) {
      res.status(400).json({ error: "No files provided" });
      return;
    }

    const config = await readFilesConfig();
    const createdFiles: AgentFile[] = [];

    for (const fileData of newFiles) {
      const { name, description, category, url, fileName, mimeType, size, tags, metadata, enabled, priority, isCurrentCatalog } = fileData;

      // Validate required fields
      if (!name || !category || !url || !fileName) {
        console.warn(`[IA Agent Files] Skipping file with missing fields:`, fileData);
        continue;
      }

      const newFile: AgentFile = {
        id: randomUUID(),
        name,
        description: description || '',
        category,
        url,
        fileName,
        mimeType: mimeType || 'application/pdf',
        size: size || 0,
        tags: tags || [],
        metadata: metadata || {},
        enabled: enabled !== false,
        priority: priority || 2,
        isCurrentCatalog: isCurrentCatalog || false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      config.files.push(newFile);
      createdFiles.push(newFile);
    }

    await writeFilesConfig(config);

    console.log(`[IA Agent Files] Batch created ${createdFiles.length} files`);
    res.json({ success: true, files: createdFiles, count: createdFiles.length });
  } catch (error) {
    console.error("[IA Agent Files] Error batch creating files:", error);
    res.status(500).json({ error: "Failed to create files" });
  }
});

/**
 * DELETE /api/ia-agent-files/batch
 * Delete multiple file entries at once
 */
router.delete("/batch", requireAuth, async (req, res) => {
  try {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "No file IDs provided" });
      return;
    }

    const config = await readFilesConfig();
    const deletedFiles: AgentFile[] = [];

    for (const id of ids) {
      const fileIndex = config.files.findIndex(f => f.id === id);
      if (fileIndex !== -1) {
        const [deletedFile] = config.files.splice(fileIndex, 1);
        deletedFiles.push(deletedFile);
      }
    }

    await writeFilesConfig(config);

    console.log(`[IA Agent Files] Batch deleted ${deletedFiles.length} files`);
    res.json({ success: true, deleted: deletedFiles, count: deletedFiles.length });
  } catch (error) {
    console.error("[IA Agent Files] Error batch deleting files:", error);
    res.status(500).json({ error: "Failed to delete files" });
  }
});

/**
 * GET /api/ia-agent-files/stats/summary
 * Get file statistics
 */
router.get("/stats/summary", requireAuth, async (req, res) => {
  try {
    const config = await readFilesConfig();

    const stats = {
      total: config.files.length,
      enabled: config.files.filter(f => f.enabled).length,
      byCategory: {
        catalog: config.files.filter(f => f.category === 'catalog').length,
        flyer: config.files.filter(f => f.category === 'flyer').length,
        info: config.files.filter(f => f.category === 'info').length,
        other: config.files.filter(f => f.category === 'other').length
      },
      totalSize: config.files.reduce((sum, f) => sum + (f.size || 0), 0)
    };

    res.json(stats);
  } catch (error) {
    console.error("[IA Agent Files] Error getting stats:", error);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

export default router;
