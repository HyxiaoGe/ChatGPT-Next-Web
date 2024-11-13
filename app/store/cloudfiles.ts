import { fetch } from "@/app/utils/stream";
import {RenderPrompt} from "@/app/components/chat";
import {isEmpty} from "lodash-es";
import {ChatCommandPrefix} from "@/app/command";
import {uploadFileToChatChat} from "@/app/utils/chat";
import fileTypesConfig from "../../public/fileTypes.json";
import { safeLocalStorage } from "@/app/utils";

interface FileItem {
  fileName: string;
  filePath: string;
}

interface ApiResponse {
  status: string;
  data: {
    files: {
      fileName: string;
      filePath: string;
      folder: number;
      fileId: string;
      fileVersion: string;
    }[];
    fileUri: string;
    fileName: string;
    count: number;
  };
}

export class CloudBaseCache {
  static async fetch(fileName: string): Promise<FileItem[]> {
    try {
      const path = `/api/files?fc=personal&key=${fileName}&offset=0&limit=10`;

      const response = await fetch(path, {
        method: "GET",
        headers: {
          accept: "application/json",
          ct: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjk4LCJ0aW1lIjoxNzMxMjg5MDgzLCJrZXkiOiIxMjM0NTY3NC4xIiwiaXAiOiIxOTIuMTY4LjI1MC4xMjQiLCJkZXZpY2UiOiJ3ZWIiLCJpYXQiOjE3MzEyODkwODN9.jM5-bydh1X2Yok9W2K2v7H1GlaoVo0SKekjDSPF5s6c",
          cv: "3.6.0",
        },
      });

      const result: ApiResponse = await response.json();
      if (result.status === 'ok' && result.data.files) {
        const files = result.data.files.filter(file => file.folder !== 1);
        for (const file of files) {
          safeLocalStorage().setItem(file.filePath + file.fileName, file.fileId + ":" +file.fileVersion);
          // await this.fetchDownloadFileUrl("personal", file.fileId, file.fileVersion);
        }
        return files.map(( {fileName, filePath} ) => ({fileName, filePath}));
      }
      return [];
    } catch (error) {
      console.error("Failed to fetch cloud file base list:", error);
      throw error;
    }
  }

  static async fetchDownloadFileUrl(fi: string, fv: string, isTempFile: boolean, knowledge_base_name?: string): Promise<void> {
    try {
      const path = `/api/file/down?fc=personal&fi=${fi}&fv=${fv}`;

      const response = await fetch(path, {
        method: "GET",
        headers: {
          accept: "application/json",
          ct: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjk4LCJ0aW1lIjoxNzMxMjk3MTQ2LCJrZXkiOiIxMjM0NTY3NC4xIiwiaXAiOiIxOTIuMTY4LjI1MC4xMjQiLCJkZXZpY2UiOiJ3ZWIiLCJpYXQiOjE3MzEyOTcxNDZ9.r4D9puRwUjb7LnKmEkOYy098c8oD4I0EX_Am2b5Rc30",
          cv: "4.13.0",
        },
      });

      const result: ApiResponse = await response.json();

      if (result.status === 'ok' && result.data) {
        await this.downloadFile(result.data.fileUri, result.data.fileName, isTempFile, knowledge_base_name);
      }
    } catch (error) {
      console.error("Failed to fetch cloud file base list:", error);
      throw error;
    }
  }

  static async downloadFile(fileUri: string, filename: string, isTempFile: boolean, knowledge_base_name?: string): Promise<void> {
    try {
      const path = `/api/content/${fileUri}&fn=${filename}`;

      const response = await fetch(path, {
        method: "GET",
        headers: {
          accept: "application/json",
          ct: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOjk4LCJ0aW1lIjoxNzMxMjk3MTQ2LCJrZXkiOiIxMjM0NTY3NC4xIiwiaXAiOiIxOTIuMTY4LjI1MC4xMjQiLCJkZXZpY2UiOiJ3ZWIiLCJpYXQiOjE3MzEyOTcxNDZ9.r4D9puRwUjb7LnKmEkOYy098c8oD4I0EX_Am2b5Rc30",
          cv: "4.13.0",
        },
      });

      if (response.ok) {
        const blob = await response.blob();
        const file = new File([blob], filename, {type: blob.type});

        const supportedFileTypes = Object.values(fileTypesConfig.supportedFileTypes).flat();
        if (!supportedFileTypes.includes(this.getMimeType(filename))) {
          throw Error('不支持的文件格式');
        }

        uploadFileToChatChat(file, isTempFile, knowledge_base_name);
      }
    } catch (error) {
      console.error("Failed to fetch cloud file base list:", error);
      throw error;
    }
  }

  private static getMimeType(filename: string): string {
    const extension = filename.toLowerCase().split('.').pop() || '';

    const mimeTypes: Record<string, string> = {
      // images
      'bmp': 'image/bmp',
      'jpeg': 'image/jpeg',
      'jpg': 'image/jpeg',
      'jp2': 'image/jp2',
      'png': 'image/png',
      'webp': 'image/webp',
      'tiff': 'image/tiff',
      'tif': 'image/tiff',
      'ico': 'image/x-icon',
      'icns': 'image/icns',
      'sgi': 'image/sgi',

      // documents
      'txt': 'text/plain',
      'md': 'text/markdown',
      'markdown': 'text/markdown',
      'pdf': 'application/pdf',
      'doc': 'application/msword',
      'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',

      // ebooks
      'epub': 'application/epub+zip',
      'mobi': 'application/x-mobipocket-ebook',

      // office
      'xls': 'application/vnd.ms-excel',
      'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'ppt': 'application/vnd.ms-powerpoint',
      'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',

      // others
      'rtf': 'application/rtf',
      'csv': 'text/csv',
      'html': 'text/html',
      'htm': 'text/html',
      'json': 'application/json',
      'xml': 'application/xml'
    };

    return mimeTypes[extension] || 'application/octet-stream';
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
        content: item.filePath,
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