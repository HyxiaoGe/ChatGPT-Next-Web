"use client";
// azure and openai, using same models. so using same LLMApi.
import {
  ApiPath,
  CHATCHAT,
  CHATCHAT_BASE_URL,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import {
  ChatMessageTool,
  useAccessStore,
  useAppConfig,
  useChatStore,
  usePluginStore,
} from "@/app/store";
import { stream } from "@/app/utils/chat";
import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  SpeechOptions,
} from "../api";
import { getClientConfig } from "@/app/config/client";
import { getMessageTextContent } from "@/app/utils";
import { fetch } from "@/app/utils/stream";
import {array} from "prop-types";

export interface RequestPayload {
  query: string;
  mode: "local_kb";
  kb_name: string;
  top_k: number;
  score_threshold: number;
  history: {
    role: "system" | "user" | "assistant";
    content: string;
  }[];
  stream: boolean;
  model: string;
  temperature: number;
  max_tokens: number;
}

export class CHATCHATApi implements LLMApi {
  private disableListModels = true;

  path(path: string): string {
    const accessStore = useAccessStore.getState();
    let baseUrl = "/chat";

    if (accessStore.useCustomConfig) {
      baseUrl = accessStore.chatchatUrl;
    }

    if (baseUrl.length === 0) {
      const isApp = !!getClientConfig()?.isApp;
      const apiPath = ApiPath.CHATCHAT;
      baseUrl = isApp ? CHATCHAT_BASE_URL : apiPath;
    }

    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, baseUrl.length - 1);
    }
    if (!baseUrl.startsWith("http") && !baseUrl.startsWith(ApiPath.CHATCHAT)) {
      baseUrl = "https://" + baseUrl;
    }

    return [baseUrl, path].join("");
  }

  extractMessage(res: any) {
    return res.choices?.at(0)?.message?.content ?? "";
  }

  speech(options: SpeechOptions): Promise<ArrayBuffer> {
    throw new Error("Method not implemented.");
  }

  async chat(options: ChatOptions) {
    console.log("--------------------chat------------------------");
    console.log("options", options);
    const history: ChatOptions["messages"] = [];
    console.log("options.messages", options.messages);
    let queryText = "";
    for (const v of options.messages) {
      console.log("v", v);
      const content = getMessageTextContent(v);
      queryText = content;
      history.push({ role: v.role, content });
    }

    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
        providerName: options.config.providerName,
      },
    };

    const requestPayload: RequestPayload = {
      query: queryText,
      mode: "local_kb",
      kb_name: "samples",
      top_k: modelConfig.top_k,
      score_threshold: modelConfig.score_threshold,
      history: [],
      stream: true,
      model: modelConfig.model,
      temperature: modelConfig.temperature,
      max_tokens: modelConfig.max_tokens,
    };

    // console.log("[Request] chatchat payload: ", requestPayload);

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);
    try {
      // const chatPath = this.path(CHATCHAT.ChatPath);
      const kbChatPath = this.path(CHATCHAT.KBChatPath);
      console.log("path: ", kbChatPath);
      const chatPayload = {
        method: "POST",
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
        headers: getHeaders(),
      };
      // make a fetch request
      const requestTimeoutId = setTimeout(
        () => controller.abort(),
        REQUEST_TIMEOUT_MS,
      );
      if (shouldStream) {
        // const [tools, funcs] = usePluginStore
        //   .getState()
        //   .getAsTools(
        //     useChatStore.getState().currentSession().mask?.plugin || [],
        //   );
        return stream(
          kbChatPath,
          requestPayload,
          getHeaders(),
          array as any,
          array as any,
          controller,
          // parseSSE
          (text: string, runTools: ChatMessageTool[]) => {
            console.log("parseSSE", text, runTools);
            const json = JSON.parse(text);
            const choices = json.choices as Array<{
              delta: {
                content: string;
                tool_calls: ChatMessageTool[];
              };
            }>;

            const tool_calls = choices[0]?.delta?.tool_calls;
            if (tool_calls?.length > 0) {
              const index = tool_calls[0]?.index;
              const id = tool_calls[0]?.id;
              const args = tool_calls[0]?.function?.arguments;
              if (id) {
                runTools.push({
                  id,
                  type: tool_calls[0]?.type,
                  function: {
                    name: tool_calls[0]?.function?.name as string,
                    arguments: args,
                  },
                });
              } else {
                // @ts-ignore
                runTools[index]["function"]["arguments"] += args;
              }
            }
            return choices[0]?.delta?.content;
          },
          // processToolMessage, include tool_calls message and tool call results
          (
            requestPayload: RequestPayload,
            toolCallMessage: any,
            toolCallResult: any[],
          ) => {
            // @ts-ignore
            requestPayload?.messages?.splice(
              // @ts-ignore
              requestPayload?.messages?.length,
              0,
              toolCallMessage,
              ...toolCallResult,
            );
          },
          options,
        );
      } else {
        const res = await fetch(kbChatPath, chatPayload);
        clearTimeout(requestTimeoutId);

        const resJson = await res.json();
        const message = this.extractMessage(resJson);
        options.onFinish(message);
      }
    } catch (e) {
      console.log("[Request] chatchat failed to make a chat request", e);
      options.onError?.(e as Error);
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
