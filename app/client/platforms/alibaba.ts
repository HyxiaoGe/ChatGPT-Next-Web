"use client";
import {
  Alibaba,
  ALIBABA_BASE_URL,
  ApiPath,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import { useAccessStore, useAppConfig, useChatStore } from "@/app/store";

import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  MultimodalContent,
  RequestMessage,
  SpeechOptions,
} from "../api";
import Locale from "../../locales";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "@/app/utils/format";
import { getClientConfig } from "@/app/config/client";
import { getMessageImages, getMessageTextContent } from "@/app/utils";
import { fetch } from "@/app/utils/stream";

export interface OpenAIListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    root: string;
  }>;
}

export class QwenApi implements LLMApi {
  path(path: string): string {
    const accessStore = useAccessStore.getState();

    let baseUrl = "";

    if (accessStore.useCustomConfig) {
      baseUrl = accessStore.alibabaUrl;
    }

    if (baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      baseUrl = isApp ? ALIBABA_BASE_URL : ApiPath.Alibaba;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http") && !baseUrl.startsWith(ApiPath.Alibaba)) {
      baseUrl = "https://" + baseUrl;
    }

    console.log("[Proxy Endpoint] ", baseUrl, path);

    return [baseUrl, path].join("/");
  }

  extractMessage(res: any) {
    return res?.output?.choices?.at(0)?.message?.content ?? "";
  }

  speech(options: SpeechOptions): Promise<ArrayBuffer> {
    throw new Error("Method not implemented.");
  }

  async chat(options: ChatOptions) {
    let isContainsImage = false;
    let requestPayload: any;

    const messages: RequestMessage[] = options.messages.map((v): RequestMessage => ({
      role: v.role,
      content: Array.isArray(v.content)
          ? v.content.find(item => item.type === "text")?.text || ""
          : getMessageTextContent(v),
    }));

    let modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        plugin: useChatStore.getState().currentSession().mask.plugin,
        model: options.config.model,
      },
    };

    const files = options.messages.map((v) => ({
      fileUrl: getMessageImages(v),
    }));

    if (files.length > 0) {
      const fileUrls = files.reduce((acc: string[], curr) => {
        if (curr && Array.isArray(curr.fileUrl)) {
          curr.fileUrl.forEach((item) => {
            if (item) acc.push(item);
          });
        }
        return acc;
      }, []);

      if (fileUrls.length > 0) {
        const rspJson = await this.uploadFile(fileUrls);
        if (typeof rspJson === "object" && rspJson !== null) {
          if (Array.isArray(rspJson)) {
            const lastUserMessageIndex = messages.map((m) => m.role).lastIndexOf("user");
            if (lastUserMessageIndex !== -1) {
              const base64 = rspJson[0]?.base64;
              isContainsImage = true;
              const originalTextContent = messages[lastUserMessageIndex].content as string;

              const imageContent: MultimodalContent = {
                type: "image_url",
                image_url: {
                  url: base64,
                },
              };
              const textContent: MultimodalContent = {
                type: "text",
                text: originalTextContent,
              };

              messages[lastUserMessageIndex] = {
                role: "user",
                content: [imageContent, textContent],
              } as RequestMessage;
            }
          } else {
            modelConfig.model = "qwen-long";
            messages.unshift({
              role: "system",
              content: "fileid://" + rspJson?.id,
            });
          }
        }
      }
    }

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    let chatPath: string;

    if (modelConfig.plugin && modelConfig.plugin[0] === "knowledge-chat") {
      requestPayload = {
        input: {
          prompt: options.messages.pop()?.content,
        },
        parameters: {
          incremental_output: shouldStream,
        },
      };
      chatPath = this.path(Alibaba.KBPath);
    } else {
      if (isContainsImage) {
        requestPayload = {
          model: "qwen-vl-max-latest",
          messages: messages,
          stream: true,
        };
        chatPath = this.path(Alibaba.ChatPath)
      } else {
        requestPayload = {
          model: modelConfig.model,
          input: {
            messages,
          },
          parameters: {
            result_format: "message",
            incremental_output: shouldStream,
            temperature: modelConfig.temperature,
            top_p: modelConfig.top_p === 1 ? 0.99 : modelConfig.top_p,
          },
        };
        chatPath = this.path(Alibaba.GenerationPath);
      }
    }

    try {
      await this.makeRequest({
        chatPath,
        requestPayload,
        controller,
        shouldStream,
        options,
      });
    } catch (e) {
      console.log("[Request] failed to make a chat request", e);
      options.onError?.(e as Error);
    }
  }

  private async makeRequest({
    chatPath,
    requestPayload,
    controller,
    shouldStream,
    options,
  }: {
    chatPath: string;
    requestPayload: any;
    controller: AbortController;
    shouldStream: boolean;
    options: ChatOptions;
  }) {
    const chatPayload = {
      method: "POST",
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
      headers: {
        ...getHeaders(),
        "X-DashScope-SSE": shouldStream ? "enable" : "disable",
      },
    };

    const requestTimeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );

    if (shouldStream) {
      await this.handleStreamResponse({
        chatPath,
        chatPayload,
        controller,
        requestTimeoutId,
        options,
      });
    } else {
      await this.handleNonStreamResponse({
        chatPath,
        chatPayload,
        requestTimeoutId,
        options,
      });
    }
  }

  private async handleStreamResponse({
    chatPath,
    chatPayload,
    controller,
    requestTimeoutId,
    options,
  }: {
    chatPath: string;
    chatPayload: any;
    controller: AbortController;
    requestTimeoutId: NodeJS.Timeout;
    options: ChatOptions;
  }) {
    let responseText = "";
    let remainText = "";
    let finished = false;

    const animateResponseText = () => {
      if (finished || controller.signal.aborted) {
        responseText += remainText;
        if (responseText?.length === 0) {
          options.onError?.(new Error("empty response from server"));
        }
        return;
      }

      if (remainText.length > 0) {
        const fetchCount = Math.max(1, Math.round(remainText.length / 60));
        const fetchText = remainText.slice(0, fetchCount);
        responseText += fetchText;
        remainText = remainText.slice(fetchCount);
        options.onUpdate?.(responseText, fetchText);
      }

      requestAnimationFrame(animateResponseText);
    };

    animateResponseText();

    const finish = () => {
      if (!finished) {
        finished = true;
        options.onFinish(responseText + remainText);
      }
    };

    controller.signal.onabort = finish;

    fetchEventSource(chatPath, {
      fetch: fetch as any,
      ...chatPayload,
      async onopen(res) {
        clearTimeout(requestTimeoutId);
        const contentType = res.headers.get("content-type");
        if (contentType?.startsWith("text/plain")) {
          responseText = await res.clone().text();
          return finish();
        }

        if (
          !res.ok ||
          !res.headers
            .get("content-type")
            ?.startsWith(EventStreamContentType) ||
          res.status !== 200
        ) {
          const responseTexts = [responseText];
          let extraInfo = await res.clone().text();
          try {
            const resJson = await res.clone().json();
            extraInfo = prettyObject(resJson);
          } catch {}

          if (res.status === 401) {
            responseTexts.push(Locale.Error.Unauthorized);
          }

          if (extraInfo) {
            responseTexts.push(extraInfo);
          }

          responseText = responseTexts.join("\n\n");
          return finish();
        }
      },
      onmessage(msg) {
        if (msg.data === "[DONE]" || finished) {
          return finish();
        }

        try {
          const json = JSON.parse(msg.data);
          if (json.output?.text) {
            remainText += json.output.text;
          } else if (json.output?.choices) {
            const choices = json.output.choices as Array<{
              message: { content: string };
            }>;
            const delta = choices[0]?.message?.content;
            if (delta) {
              remainText += delta;
            }
          } else if (json.choices[0]) {
            console.log("[Request] delta content", json.choices[0].delta.content);
            if (json.choices[0].delta.content) {
              remainText += json.choices[0].delta.content;
            }
          }
        } catch (e) {
          console.error("[Request] parse error", msg);
        }
      },
      onclose() {
        finish();
      },
      onerror(e) {
        options.onError?.(e);
        throw e;
      },
      openWhenHidden: true,
    });
  }

  private async handleNonStreamResponse({
    chatPath,
    chatPayload,
    requestTimeoutId,
    options,
  }: {
    chatPath: string;
    chatPayload: any;
    requestTimeoutId: NodeJS.Timeout;
    options: ChatOptions;
  }) {
    const res = await fetch(chatPath, chatPayload);
    clearTimeout(requestTimeoutId);

    const resJson = await res.json();
    const message = this.extractMessage(resJson);
    options.onFinish(message);
  }

  async uploadFile(fileUrls: string[]) {
    try {
      const imageExtensions = [
        "jpg",
        "jpeg",
        "png",
        "gif",
        "webp",
        "bmp",
        "svg",
        "ico",
        "tiff",
        "tif",
        "avif",
      ];

      const categorizedUrls = fileUrls.reduce(
        (acc, url) => {
          const extension = url.split(".").pop()?.toLowerCase() || "";
          if (imageExtensions.includes(extension)) {
            acc.imageUrls.push(url);
          } else {
            acc.fileUrls.push(url);
          }
          return acc;
        },
        { imageUrls: [] as string[], fileUrls: [] as string[] },
      );

      const filePromises = categorizedUrls.fileUrls.map((url) =>
        this.urlToFile(url),
      );
      const files = await Promise.all(filePromises);

      for (let file of files) {
        const result = await this.uploadNonPictureFile(file);
        if (result?.status === "processed") {
          return result;
        }
      }

      const imagePromises = categorizedUrls.imageUrls.map(async (url) => {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise<{ file: File; base64: string }>(
          (resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = reader.result as string;
              const filename = url.split("/").pop() || "image";
              const file = new File([blob], filename, { type: blob.type });
              resolve({ file, base64 });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          },
        );
      });
      return await Promise.all(imagePromises);
    } catch (error) {
      console.error("[Upload Failed]", error);
      throw error;
    }
  }

  private async uploadNonPictureFile(file: File) {
    const formData = new FormData();
    formData.append("purpose", "file-extract");
    formData.append("file", file);

    const res = await fetch(Alibaba.UploadPath, {
      method: "POST",
      body: formData,
      headers: {
        Authorization: `Bearer ${useAccessStore.getState().alibabaApiKey}`,
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error("[Upload Error]", {
        status: res.status,
        statusText: res.statusText,
        error: errorText,
      });
      throw new Error(errorText);
    }

    return await res.json();
  }

  private async urlToFile(url: string): Promise<File> {
    try {
      const response = await window.fetch(url);
      const blob = await response.blob();
      const filename = url.split("/").pop() || "document";

      // 扩展文件类型映射
      const mimeTypes: Record<string, string> = {
        ".md": "text/markdown",
        ".txt": "text/plain",
        ".json": "application/json",
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".csv": "text/csv",
      };

      // 获取文件扩展名
      const ext = "." + filename.split(".").pop()?.toLowerCase();
      const contentType =
        mimeTypes[ext] || blob.type || "application/octet-stream";

      if (contentType === "application/octet-stream") {
        console.warn(
          `Warning: Using generic content type for file ${filename}`,
        );
      }

      return new File([blob], filename, { type: contentType });
    } catch (e) {
      console.error(`Failed to fetch file from URL: ${url}`, e);
      throw new Error(`Failed to fetch file from URL: ${url}`);
    }
  }

  async usage() {
    return {
      used: 0,
      total: 0,
    };
  }

  async models(): Promise<LLMModel[]> {
    return [];
  }
}

export { Alibaba };
