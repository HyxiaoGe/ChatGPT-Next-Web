import { fetch } from "@/app/utils/stream";
import {RenderPrompt} from "@/app/components/chat";
import {isEmpty} from "lodash-es";
import {ChatCommandPrefix} from "@/app/command";

interface FileItem {
  fileName: string;
}

interface ApiResponse {
  status: string;
  data: {
    files: {
      fileName: string;
      folder: number;
    }[];
    count: number;
  };
}

export class CloudBaseCache {
  private static async fetch(fileName: string): Promise<FileItem[]> {
    try {
      const path = `/api/files?fc=personal&key=${fileName}&offset=0&limit=20`;

      const response = await fetch(path, {
        method: "GET",
        headers: {
          accept: "application/json",
          ct: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjk3LCJ0aW1lIjoxNzMwOTc0NDEzLCJrZXkiOiIxMjM0NTY3NC4xIiwiaXAiOiIxOTIuMTY4LjI1MC4xMjYiLCJkZXZpY2UiOiJ3ZWIiLCJpYXQiOjE3MzA5NzQ0MTN9.xTuKSBKY3oH7mzUrHy-vTrfy2_jCC7UbTnNk9n56MT0"
        },
      });

      const result: ApiResponse = await response.json();
      if (result.status === 'ok' && result.data.files) {
        return result.data.files.filter(file => file.folder !== 1).map(( {fileName} ) => ({fileName}));
      }

      throw new Error(`API returned error code: ${result.status}`);
    } catch (error) {
      console.error("Failed to fetch cloudfile base list:", error);
      throw error;
    }
  }

  static async searchCommands(searchText: string): Promise<RenderPrompt[]> {
    const match = searchText.match(ChatCommandPrefix);
    if (match) {
      searchText = searchText.slice(1);
    }
    if (isEmpty(searchText)) {
      return [];
    }
    try {
      const cachedData = await this.fetch(searchText) as any[];
      if (!cachedData || !Array.isArray(cachedData)) {
        return [];
      }
      const commands = cachedData.map((item) => ({
        title: item.fileName,
        content: "一粒云云盘",
      }));

      if (searchText) {
        const search = searchText.toLowerCase().replace(/^[@＠]/, "");
        return commands.filter(
            (cmd) =>
                cmd.title.toLowerCase().includes(search) ||
                cmd.content.toLowerCase().includes(search)
        );
      }

      return commands;
    } catch (error) {
      console.error("Error searching commands:", error);
      return [];
    }
  }
}