import { getClientConfig } from "../config/client";
import {
  ACCESS_CODE_PREFIX,
  CHATCHAT,
  CHATCHAT_BASE_URL,
  ModelProvider,
  ServiceProvider,
} from "../constant";
import {
  ChatMessage,
  ChatMessageTool,
  ModelType,
  useAccessStore,
  useChatStore,
} from "../store";
import { ChatGPTApi, DalleRequestPayload } from "./platforms/openai";
import { GeminiProApi } from "./platforms/google";
import { ClaudeApi } from "./platforms/anthropic";
import { ErnieApi } from "./platforms/baidu";
import { DoubaoApi } from "./platforms/bytedance";
import { QwenApi } from "./platforms/alibaba";
import { HunyuanApi } from "./platforms/tencent";
import { MoonshotApi } from "./platforms/moonshot";
import { SparkApi } from "./platforms/iflytek";
import { XAIApi } from "./platforms/xai";
import { CHATCHATApi } from "@/app/client/platforms/chatchat";
import { fetch } from "@/app/utils/stream";

export const ROLES = ["system", "user", "assistant"] as const;
export type MessageRole = (typeof ROLES)[number];

export const Models = ["gpt-3.5-turbo", "gpt-4"] as const;
export const TTSModels = ["tts-1", "tts-1-hd"] as const;
export type ChatModel = ModelType;

export interface MultimodalContent {
  type: "text" | "file_url";
  text?: string;
  file_url?: {
    url: string;
  };
}

export interface RequestMessage {
  role: MessageRole;
  content: string | MultimodalContent[];
}

export interface LLMConfig {
  model: string;
  providerName?: string;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
  presence_penalty?: number;
  frequency_penalty?: number;
  size?: DalleRequestPayload["size"];
  quality?: DalleRequestPayload["quality"];
  style?: DalleRequestPayload["style"];
}

export interface SpeechOptions {
  model: string;
  input: string;
  voice: string;
  response_format?: string;
  speed?: number;
  onController?: (controller: AbortController) => void;
}

export interface ChatOptions {
  messages: RequestMessage[];
  config: LLMConfig;

  onUpdate?: (message: string, chunk: string) => void;
  onFinish: (message: string) => void;
  onError?: (err: Error) => void;
  onController?: (controller: AbortController) => void;
  onBeforeTool?: (tool: ChatMessageTool) => void;
  onAfterTool?: (tool: ChatMessageTool) => void;
}

export interface UploadFileOptions {
  files: (File | string)[];
  knowledgeBaseName: string;
  config: {
    toVectorStore?: boolean;
    override?: boolean;
    notRefreshVsCache?: boolean;
    chunkSize?: number;
    chunkOverlap?: number;
    zhTitleEnhance?: boolean;
  };

  onFinish: (response: any) => void;
  onError?: (err: Error) => void;
  onController?: (controller: AbortController) => void;
}

export interface KBChatOptions {
  messages: RequestMessage[];
  config: KBChatConfig;
  callbacks?: Callbacks;
}

export interface KBChatConfig {
  mode: string;
  kbName: string;
  topK: number;
  scoreThreshold: number;
  model: string;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  promptName: string;
  returnDirect: boolean;
}

export interface RoleConfig {
  role: "user" | "assistant";
  content: string;
}

export interface Callbacks {
  onUpdate?: (message: string, chunk: string) => void;
  onFinish: (message: string) => void;
  onError?: (err: Error) => void;
  onController?: (controller: AbortController) => void;
  onBeforeTool?: (tool: ChatMessageTool) => void;
  onAfterTool?: (tool: ChatMessageTool) => void;
}

export interface LLMUsage {
  used: number;
  total: number;
}

export interface LLMModel {
  name: string;
  displayName?: string;
  available: boolean;
  provider: LLMModelProvider;
  sorted: number;
}

export interface LLMModelProvider {
  id: string;
  providerName: string;
  providerType: string;
  sorted: number;
}

export abstract class LLMApi {
  abstract chat(options: ChatOptions): Promise<void>;

  abstract speech(options: SpeechOptions): Promise<ArrayBuffer>;

  abstract usage(): Promise<LLMUsage>;

  abstract models(): Promise<LLMModel[]>;
}

type ProviderName = "openai" | "azure" | "claude" | "palm" | "chatchat";

interface Model {
  name: string;
  provider: ProviderName;
  ctxlen: number;
}

interface ChatProvider {
  name: ProviderName;
  apiConfig: {
    baseUrl: string;
    apiKey: string;
    summaryModel: Model;
  };
  models: Model[];

  chat: () => void;
  usage: () => void;
}

export class ClientApi {
  public llm: LLMApi;

  constructor(provider: ModelProvider = ModelProvider.GPT) {
    switch (provider) {
      case ModelProvider.GeminiPro:
        this.llm = new GeminiProApi();
        break;
      case ModelProvider.Claude:
        this.llm = new ClaudeApi();
        break;
      case ModelProvider.Ernie:
        this.llm = new ErnieApi();
        break;
      case ModelProvider.Doubao:
        this.llm = new DoubaoApi();
        break;
      case ModelProvider.Qwen:
        this.llm = new QwenApi();
        break;
      case ModelProvider.Hunyuan:
        this.llm = new HunyuanApi();
        break;
      case ModelProvider.Moonshot:
        this.llm = new MoonshotApi();
        break;
      case ModelProvider.Iflytek:
        this.llm = new SparkApi();
        break;
      case ModelProvider.XAI:
        this.llm = new XAIApi();
        break;
      case ModelProvider.CHATCHAT:
        this.llm = new CHATCHATApi();
        break;
      default:
        this.llm = new ChatGPTApi();
    }
  }

  config() {}

  prompts() {}

  masks() {}

  async share(messages: ChatMessage[], avatarUrl: string | null = null) {
    const msgs = messages
      .map((m) => ({
        from: m.role === "user" ? "human" : "gpt",
        value: m.content,
      }))
      .concat([
        {
          from: "human",
          value:
            "Share from [NextChat]: https://github.com/Yidadaa/ChatGPT-Next-Web",
        },
      ]);
    // 敬告二开开发者们，为了开源大模型的发展，请不要修改上述消息，此消息用于后续数据清洗使用
    // Please do not modify this message

    console.log("[Share]", messages, msgs);
    const clientConfig = getClientConfig();
    const proxyUrl = "/sharegpt";
    const rawUrl = "https://sharegpt.com/api/conversations";
    const shareUrl = clientConfig?.isApp ? rawUrl : proxyUrl;
    const res = await fetch(shareUrl, {
      body: JSON.stringify({
        avatarUrl,
        items: msgs,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const resJson = await res.json();
    console.log("[Share]", resJson);
    if (resJson.id) {
      return `https://shareg.pt/${resJson.id}`;
    }
  }

  async uploadFile(options: UploadFileOptions) {
    const formData = new FormData();
    const controller = new AbortController();

    options.onController?.(controller);

    console.log("[Request] Uploading documents", options.files);
    try {
      for (const file of options.files) {
        if (typeof file === "string") {
          const fileObj = await this.urlToFile(file);
          formData.append("files", fileObj);
        } else {
          formData.append("files", file);
        }
      }

      // Add other parameters
      formData.append("knowledge_base_name", options.knowledgeBaseName);
      formData.append(
        "to_vector_store",
        (options.config.toVectorStore ?? true).toString(),
      );
      formData.append(
        "override",
        (options.config.override ?? false).toString(),
      );
      formData.append(
        "not_refresh_vs_cache",
        (options.config.notRefreshVsCache ?? false).toString(),
      );
      formData.append(
        "chunk_size",
        (options.config.chunkSize ?? 750).toString(),
      );
      formData.append(
        "chunk_overlap",
        (options.config.chunkOverlap ?? 150).toString(),
      );
      formData.append(
        "zh_title_enhance",
        (options.config.zhTitleEnhance ?? false).toString(),
      );
      formData.append("docs", "");

      const uploadPath = CHATCHAT_BASE_URL.concat(CHATCHAT.UploadFilePath);
      console.log("[Request] Uploading documents to", uploadPath);
      const response = await fetch(uploadPath, {
        method: "POST",
        body: formData,
        signal: controller.signal,
        headers: {
          accept: "application/json",
        },
        mode: "cors",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`Upload failed with status: ${response.status}`);
      }

      const result = await response.json();
      options.onFinish(result);

      return result;
    } catch (e) {
      console.error("[Request] Failed to upload documents", e);
      options.onError?.(e as Error);
      throw e;
    }
  }

  private async urlToFile(url: string): Promise<File> {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const filename = url.split("/").pop() || "下载文件";
      return new File([blob], filename, { type: blob.type });
    } catch (e) {
      throw new Error(`Failed to fetch file from URL: ${url}`);
    }
  }

  async kbChat(options: ChatOptions) {}
}

export function getBearerToken(
  apiKey: string,
  noBearer: boolean = false,
): string {
  return validString(apiKey)
    ? `${noBearer ? "" : "Bearer "}${apiKey.trim()}`
    : "";
}

export function validString(x: string): boolean {
  return x?.length > 0;
}

export function getHeaders(ignoreHeaders: boolean = false) {
  const accessStore = useAccessStore.getState();
  const chatStore = useChatStore.getState();
  let headers: Record<string, string> = {};
  if (!ignoreHeaders) {
    headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
  }

  const clientConfig = getClientConfig();

  function getConfig() {
    const modelConfig = chatStore.currentSession().mask.modelConfig;
    const isGoogle = modelConfig.providerName === ServiceProvider.Google;
    const isAzure = modelConfig.providerName === ServiceProvider.Azure;
    const isAnthropic = modelConfig.providerName === ServiceProvider.Anthropic;
    const isBaidu = modelConfig.providerName == ServiceProvider.Baidu;
    const isByteDance = modelConfig.providerName === ServiceProvider.ByteDance;
    const isAlibaba = modelConfig.providerName === ServiceProvider.Alibaba;
    const isMoonshot = modelConfig.providerName === ServiceProvider.Moonshot;
    const isIflytek = modelConfig.providerName === ServiceProvider.Iflytek;
    const isXAI = modelConfig.providerName === ServiceProvider.XAI;
    const isEnabledAccessControl = accessStore.enabledAccessControl();
    const apiKey = isGoogle
      ? accessStore.googleApiKey
      : isAzure
      ? accessStore.azureApiKey
      : isAnthropic
      ? accessStore.anthropicApiKey
      : isByteDance
      ? accessStore.bytedanceApiKey
      : isAlibaba
      ? accessStore.alibabaApiKey
      : isMoonshot
      ? accessStore.moonshotApiKey
      : isXAI
      ? accessStore.xaiApiKey
      : isIflytek
      ? accessStore.iflytekApiKey && accessStore.iflytekApiSecret
        ? accessStore.iflytekApiKey + ":" + accessStore.iflytekApiSecret
        : ""
      : accessStore.openaiApiKey;
    return {
      isGoogle,
      isAzure,
      isAnthropic,
      isBaidu,
      isByteDance,
      isAlibaba,
      isMoonshot,
      isIflytek,
      isXAI,
      apiKey,
      isEnabledAccessControl,
    };
  }

  function getAuthHeader(): string {
    return isAzure
      ? "api-key"
      : isAnthropic
      ? "x-api-key"
      : isGoogle
      ? "x-goog-api-key"
      : "Authorization";
  }

  const {
    isGoogle,
    isAzure,
    isAnthropic,
    isBaidu,
    apiKey,
    isEnabledAccessControl,
  } = getConfig();
  // when using baidu api in app, not set auth header
  if (isBaidu && clientConfig?.isApp) return headers;

  const authHeader = getAuthHeader();

  const bearerToken = getBearerToken(
    apiKey,
    isAzure || isAnthropic || isGoogle,
  );

  if (bearerToken) {
    headers[authHeader] = bearerToken;
  } else if (isEnabledAccessControl && validString(accessStore.accessCode)) {
    headers["Authorization"] = getBearerToken(
      ACCESS_CODE_PREFIX + accessStore.accessCode,
    );
  }

  return headers;
}

export function getClientApi(provider: ServiceProvider): ClientApi {
  switch (provider) {
    case ServiceProvider.Google:
      return new ClientApi(ModelProvider.GeminiPro);
    case ServiceProvider.Anthropic:
      return new ClientApi(ModelProvider.Claude);
    case ServiceProvider.Baidu:
      return new ClientApi(ModelProvider.Ernie);
    case ServiceProvider.ByteDance:
      return new ClientApi(ModelProvider.Doubao);
    case ServiceProvider.Alibaba:
      return new ClientApi(ModelProvider.Qwen);
    case ServiceProvider.Tencent:
      return new ClientApi(ModelProvider.Hunyuan);
    case ServiceProvider.Moonshot:
      return new ClientApi(ModelProvider.Moonshot);
    case ServiceProvider.Iflytek:
      return new ClientApi(ModelProvider.Iflytek);
    case ServiceProvider.XAI:
      return new ClientApi(ModelProvider.XAI);
    case ServiceProvider.CHATCHAT:
      return new ClientApi(ModelProvider.CHATCHAT);
    default:
      return new ClientApi(ModelProvider.GPT);
  }
}
