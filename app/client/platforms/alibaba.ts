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
  SpeechOptions,
} from "../api";
import Locale from "../../locales";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "@/app/utils/format";
import { getClientConfig } from "@/app/config/client";
import { getMessageTextContent } from "@/app/utils";
import { fetch } from "@/app/utils/stream";

export interface OpenAIListModelResponse {
  object: string;
  data: Array<{
    id: string;
    object: string;
    root: string;
  }>;
}

interface RequestInput {
  messages: {
    role: "system" | "user" | "assistant";
    content: string | MultimodalContent[];
  }[];
}

interface RequestParam {
  result_format: string;
  incremental_output?: boolean;
  temperature: number;
  repetition_penalty?: number;
  top_p: number;
  max_tokens?: number;
}

interface RequestPayload {
  model: string;
  input: RequestInput;
  parameters: RequestParam;
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
    const messages = options.messages.map((v) => ({
      role: v.role,
      content: getMessageTextContent(v),
    }));

    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        plugin: useChatStore.getState().currentSession().mask.plugin,
        model: options.config.model,
      },
    };

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    let requestPayload: any;
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
      chatPath = this.path(Alibaba.ChatPath);
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
        console.log("[Response Animation] finished");
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
        console.log("[Alibaba] request response content type: ", contentType);

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
