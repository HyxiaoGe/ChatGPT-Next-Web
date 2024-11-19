"use client";
// azure and openai, using same models. so using same LLMApi.
import {
  ApiPath,
  CHATCHAT,
  CHATCHAT_BASE_URL,
  REQUEST_TIMEOUT_MS,
} from "@/app/constant";
import { useAccessStore, useAppConfig, useChatStore } from "@/app/store";
import {
  ChatOptions,
  getHeaders,
  LLMApi,
  LLMModel,
  SpeechOptions,
} from "../api";
import Locale from "../../locales";
import { getClientConfig } from "@/app/config/client";
import { getMessageTextContent, getMessageImages } from "@/app/utils";
import { fetch } from "@/app/utils/stream";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "@/app/utils/format";
import { isEmpty } from "lodash-es";

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
    let requestPayload: any;
    let path: string = "";

    const history: ChatOptions["messages"] = [];
    let queryText = "";
    for (const v of options.messages) {
      const content = getMessageTextContent(v);
      queryText = content;
      history.push({ role: v.role, content });

      const tempId = getMessageImages(v)[0];
        if (tempId) {
            path = this.path(CHATCHAT.FileChatPath(tempId));
        }
    }

    const modelConfig = {
      ...useAppConfig.getState().modelConfig,
      ...useChatStore.getState().currentSession().mask.modelConfig,
      ...{
        model: options.config.model,
        providerName: options.config.providerName,
        knowledgeBase: options.config.knowledgeBase,
        plugin: useChatStore.getState().currentSession().mask.plugin,
      },
    };

    const shouldStream = !!options.config.stream;
    const controller = new AbortController();
    options.onController?.(controller);

    if (modelConfig.plugin) {
      if (modelConfig.plugin[0] === "simple-chat" || modelConfig.plugin[0] === "file-chat") {
        if (modelConfig.plugin[0] === "simple-chat" || path === "") {
          path = this.path(CHATCHAT.ChatPath);
        }
        console.log("current plugin: ", modelConfig.plugin[0]);
        console.log("current path: ", path)
        const messages = options.messages.map((v) => ({
          role: v.role === "system" ? "user" : v.role,
          content: getMessageTextContent(v).replace(/@.*?:/,'').trim(),
        }));
        requestPayload = {
          model: modelConfig.model,
          messages: messages,
          temperature: modelConfig.temperature,
          stream: shouldStream
        };
      } else if (modelConfig.plugin[0] === "knowledge-chat") {
        path = this.path(CHATCHAT.KBChatPath);
        requestPayload = {
          query: queryText,
          mode: "local_kb",
          kb_name: modelConfig.knowledgeBase,
          top_k: modelConfig.top_k,
          score_threshold: modelConfig.score_threshold,
          history: [],
          stream: true,
          model: modelConfig.model,
          temperature: modelConfig.temperature,
          max_tokens: modelConfig.max_tokens,
        };
      }
    }
    try {
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
        let responseText = "";
        let remainText = "";
        let finished = false;
        let animationStarted = false;

        function startAnimation() {
          if (animationStarted) return;
          animationStarted = true;
          animateResponseText();
        }

        // animate response to make it looks smooth
        function animateResponseText() {
          if (controller.signal.aborted) {
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
        }

        // start animaion
        animateResponseText();

        const finish = () => {
          if (!finished) {
            console.log("[Request] finish");
            finished = true;
            options.onFinish(responseText + remainText);
          }
        };

        controller.signal.onabort = finish;

        fetchEventSource(path, {
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
            const text = msg.data;
            try {
              if (isEmpty(text)) {
                return;
              }
              const json = JSON.parse(text);
              if (json.choices) {
                if (json.choices.at(0)?.message?.content) {
                  const message = json.choices.at(0)?.message?.content ?? "";
                  if (message) {
                    remainText += message;
                    startAnimation();
                  }
                } else if (json.choices.at(0)?.delta?.content) {
                  const delta = json.choices.at(0)?.delta?.content ?? "";
                  if (delta) {
                    remainText += delta;
                    startAnimation();
                  }
                } else if (json.choices.at(0)?.finish_reason) {
                  if (json.choices.at(0)?.finish_reason === "stop") {
                    console.log("[Request] finish_reason: stop");
                    finish();
                  }
                }
              }
            } catch (e) {
              console.error("[Request] parse error", text, msg);
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
      } else {
        const res = await fetch(path, chatPayload);
        clearTimeout(requestTimeoutId);
        const resJson = await res.json();

        const message = this.extractMessage(resJson);
        console.log("[Request] message ", message);
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
