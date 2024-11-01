import { safeLocalStorage } from "../utils";
import { fetch } from "@/app/utils/stream";
import { RenderPrompt } from "@/app/components/chat";

const storage = safeLocalStorage();
const KNOWLEDGE_BASE_CACHE_KEY = "knowledge_base_cache_";
const CACHE_EXPIRY_TIME = 1000 * 60 * 60;

interface FileItem {
  kb_name: string;
  file_name: string;
}

interface ApiResponse {
  code: number;
  msg: string;
  data: FileItem[];
}

interface CacheData {
  timestamp: number;
  data: FileItem[];
}

export class KnowledgeBaseCache {
  static async getFileList(kb_name: string = "samples"): Promise<FileItem[]> {
    const cachedData = this.getFromCache(kb_name);
    if (cachedData) {
      return cachedData;
    }

    return await this.fetchAndCache(kb_name);
  }

  private static getFromCache(kb_name: string = "samples"): FileItem[] | null {
    const cached = storage.getItem(KNOWLEDGE_BASE_CACHE_KEY + kb_name);
    if (!cached) {
      return null;
    }

    try {
      const cacheData: CacheData = JSON.parse(cached);
      if (Date.now() - cacheData.timestamp < CACHE_EXPIRY_TIME) {
        return cacheData.data;
      }

      this.clearCache();
      return null;
    } catch (e) {
      console.error("Failed to parse cache:", e);
      this.clearCache();
      return null;
    }
  }

  private static async fetchAndCache(kb_name: string): Promise<FileItem[]> {
    try {
      const path = `/knowledge_base/list_files?knowledge_base_name=${kb_name}`;

      console.log("[Request] fetch documents to", path);

      const response = await fetch(path, {
        method: "GET",
        headers: {
          accept: "application/json",
        },
      });
      if (!response.ok) {
        throw new Error(`Failed failed with status: ${response.status}`);
      }

      const result: ApiResponse = await response.json();
      console.log("result: ", result);

      if (result.code === 200) {
        const cacheData: CacheData = {
          timestamp: Date.now(),
          data: result.data,
        };
        storage.setItem(
          KNOWLEDGE_BASE_CACHE_KEY + kb_name,
          JSON.stringify(cacheData),
        );
        return result.data;
      }
      throw new Error(`API returned error code: ${result.code}`);
    } catch (error) {
      console.error("Failed to fetch knowledge base list:", error);
      throw error;
    }
  }

  static clearCache() {
    storage.removeItem(KNOWLEDGE_BASE_CACHE_KEY);
  }

  static async refreshCahce(kb_name: string = "samples"): Promise<FileItem[]> {
    this.clearCache();
    return await this.fetchAndCache(kb_name);
  }

  static searchCommands(searchText: string): RenderPrompt[] {
    const cachedData = this.getFromCache();
    if (!cachedData) {
      return [];
    }

    const commands = cachedData.map((item) => ({
      title: item.file_name,
      content: item.kb_name,
    }));

    if (searchText) {
      const search = searchText.toLowerCase().replace(/^[@＠]/, "");
      return commands.filter(
        (cmd) =>
          cmd.title.toLowerCase().includes(search) ||
          cmd.content.toLowerCase().includes(search),
      );
    }

    return commands;
  }
}
