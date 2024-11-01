import {
  CACHE_URL_PREFIX,
  REQUEST_TIMEOUT_MS,
  UPLOAD_URL,
} from "@/app/constant";
import { RequestMessage } from "@/app/client/api";
import Locale from "@/app/locales";
import {
  EventStreamContentType,
  fetchEventSource,
} from "@fortaine/fetch-event-source";
import { prettyObject } from "./format";
import { fetch as tauriFetch } from "./stream";
import { isEmpty } from "lodash-es";

export async function preProcessFileContent(
  content: RequestMessage["content"],
) {
  if (typeof content === "string") {
    return content;
  }
  const result = [];
  for (const part of content) {
    if (part?.type == "file_url" && part?.file_url?.url) {
      try {
        const url = await cacheFileUrl(part?.file_url?.url);
        result.push({ type: part.type, file_url: { url } });
      } catch (error) {
        console.error("Error processing file URL:", error);
      }
    } else {
      result.push({ ...part });
    }
  }
  return result;
}

const fileUrlCaches: Record<string, string> = {};

export function cacheFileUrl(fileUrl: string) {
  if (fileUrl.includes(CACHE_URL_PREFIX)) {
    if (!fileUrlCaches[fileUrl]) {
      const reader = new FileReader();
      return fetch(fileUrl, {
        method: "GET",
        mode: "cors",
        credentials: "include",
      })
        .then((res) => res.blob())
        .then((blob) => {
          // 直接缓存文件URL
          fileUrlCaches[fileUrl] = URL.createObjectURL(blob);
          return fileUrlCaches[fileUrl];
        });
    }
    return Promise.resolve(fileUrlCaches[fileUrl]);
  }
  return Promise.resolve(fileUrl);
}

export function uploadFile(file: File): Promise<string> {
  const body = new FormData();
  body.append("file", file);

  return fetch(UPLOAD_URL, {
    method: "post",
    body,
    mode: "cors",
    credentials: "include",
  })
    .then((res) => res.json())
    .then((res) => {
      console.log("Upload response", res);
      if (res?.code == 0 && res?.data) {
        return res?.data;
      }
      throw Error(`upload Error: ${res?.msg}`);
    });
}

export function removeFile(fileUrl: string) {
  return fetch(fileUrl, {
    method: "DELETE",
    mode: "cors",
    credentials: "include",
  });
}

export function stream(
  chatPath: string,
  requestPayload: any,
  headers: any,
  tools: any[],
  funcs: Record<string, Function>,
  controller: AbortController,
  parseSSE: (text: string, runTools: any[]) => string | undefined,
  processToolMessage: (
    requestPayload: any,
    toolCallMessage: any,
    toolCallResult: any[],
  ) => void,
  options: any,
) {
  let responseText = "";
  let remainText = "";
  let finished = false;
  let running = false;
  let runTools: any[] = [];

  // animate response to make it looks smooth
  function animateResponseText() {
    // 移除动画函数，因为我们不再需要它
    // 每个 content 片段会直接显示
    if (finished || controller.signal.aborted) {
      console.log("[Response Animation] finished");
      if (responseText?.length === 0) {
        options.onError?.(new Error("empty response from server"));
      }
      return;
    }
  }

  // start animaion
  animateResponseText();

  const finish = (content: string | undefined) => {
    if (finished) return;
    console.debug("[ChatAPI] end");
    finished = true;
    // 停止动画
    controller.abort();
    // 确保使用传入的 content 或已累积的 responseText
    options.onFinish(content || responseText);
  };

  // @ts-ignore
  controller.signal.onabort = finish;

  let lastPromise = Promise.resolve();

  function chatApi(
    chatPath: string,
    headers: any,
    requestPayload: any,
    tools: any,
  ) {
    const chatPayload = {
      method: "POST",
      body: JSON.stringify({
        ...requestPayload,
        tools: tools && tools.length ? tools : undefined,
      }),
      signal: controller.signal,
      headers,
    };
    const requestTimeoutId = setTimeout(
      () => controller.abort(),
      REQUEST_TIMEOUT_MS,
    );
    fetchEventSource(chatPath, {
      fetch: tauriFetch as any,
      ...chatPayload,
      async onopen(res) {
        clearTimeout(requestTimeoutId);
        const contentType = res.headers.get("content-type");

        if (contentType?.startsWith("text/plain")) {
          responseText = await res.clone().text();
          return finish(responseText);
        }
        if (
          !res.ok ||
          !res.body ||
          res.body instanceof ReadableStream ||
          res.status !== 200 ||
          !res.headers
            .get("content-type")
            ?.toLowerCase()
            .includes(EventStreamContentType)
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

          return;
        }
      },
      onmessage(msg) {
        try {
          if (!isEmpty(msg.data)) {
            const data = JSON.parse(msg.data);
            const content = data.choices?.[0]?.delta?.content || "";

            if (content) {
              lastPromise = lastPromise.then(() => {
                return new Promise((resolve) => {
                  setTimeout(() => {
                    responseText += content;
                    options.onUpdate?.(responseText, content);
                    resolve();
                  }, 100);
                });
              });
            }
          }
        } catch (e) {
          console.error("[Request] parse error", msg.data, e);
        }
      },
      onclose() {
        finish("");
      },
      onerror(e) {
        options?.onError?.(e);
        throw e;
      },
      openWhenHidden: true,
    });
  }

  console.debug("[ChatAPI] start");
  chatApi(chatPath, headers, requestPayload, tools); // call fetchEventSource
}
