import webpack from "webpack";

const mode = process.env.BUILD_MODE ?? "standalone";
console.log("[Next] build mode", mode);

const disableChunk = !!process.env.DISABLE_CHUNK || mode === "export";
console.log("[Next] build with chunk: ", !disableChunk);

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ["@svgr/webpack"],
    });

    if (disableChunk) {
      config.plugins.push(
        new webpack.optimize.LimitChunkCountPlugin({ maxChunks: 1 }),
      );
    }

    config.resolve.fallback = {
      child_process: false,
    };

    return config;
  },
  output: mode,
  images: {
    unoptimized: mode === "export",
  },
  experimental: {
    forceSwcTransforms: true,
  },
};

const CorsHeaders = [
  { key: "Access-Control-Allow-Credentials", value: "true" },
  { key: "Access-Control-Allow-Origin", value: "*" },
  {
    key: "Access-Control-Allow-Methods",
    value: "*",
  },
  {
    key: "Access-Control-Allow-Headers",
    value: "*",
  },
  {
    key: "Access-Control-Max-Age",
    value: "86400",
  },
];

if (mode !== "export") {
  nextConfig.headers = async () => {
    return [
      {
        source: "/api/:path*",
        headers: CorsHeaders,
      },
    ];
  };

  nextConfig.rewrites = async () => {
    const ret = [
      {
        source: "/api/proxy/azure/:resource_name/deployments/:deploy_name/:path*",
        destination: "https://:resource_name.openai.azure.com/openai/deployments/:deploy_name/:path*",
      },
      {
        source: "/api/proxy/google/:path*",
        destination: "https://generativelanguage.googleapis.com/:path*",
      },
      {
        source: "/api/proxy/openai/:path*",
        destination: "https://api.openai.com/:path*",
      },
      {
        source: "/api/proxy/anthropic/:path*",
        destination: "https://api.anthropic.com/:path*",
      },
      {
        source: "/google-fonts/:path*",
        destination: "https://fonts.googleapis.com/:path*",
      },
      {
        source: "/sharegpt",
        destination: "https://sharegpt.com/api/conversations",
      },
      {
        source: "/api/proxy/alibaba/:path*",
        destination: "https://dashscope.aliyuncs.com/api/:path*",
      },
      {
        source: "/api/alibaba/v1/:path",
        destination: "https://dashscope.aliyuncs.com/compatible-mode/v1/:path",
      },
      {
        source: "/api/baidu/:path*",
        destination: "https://aip.baidubce.com/:path*",
      },
      {
        source: '/api/files/:path*',
        destination: 'http://192.168.250.217/apps/files/:path*'
      },
      {
        source: '/api/file/:path*',
        destination: 'http://192.168.250.217/apps/file/:path*'
      },
      {
        source: '/api/content/:path*',
        destination: 'http://192.168.250.217/:path*'
      },
      {
        source: "/chat/:path*",
        destination: 'http://127.0.0.1:7861/chat/chat/:path*',
      },
      {
        source: '/kb_chat/:path*',
        destination: 'http://127.0.0.1:7861/chat/kb_chat/:path*',
        basePath: false,
      },
      {
        source: '/knowledge_base/list_knowledge_bases',
        destination: 'http://127.0.0.1:7861/knowledge_base/list_knowledge_bases',
        basePath: false,
      },
      {
        source: '/knowledge_base/upload_docs',
        destination: 'http://127.0.0.1:7861/knowledge_base/upload_docs',
        basePath: false,
      },
      {
        source: '/knowledge_base/upload_temp_docs/:path*',
        destination: 'http://127.0.0.1:7861/knowledge_base/upload_temp_docs/:path*',
        basePath: false,
      },
      {
        source: '/knowledge_base/temp_kb/:path*',
        destination: 'http://127.0.0.1:7861/knowledge_base/temp_kb/:path*',
        basePath: false,
      },
      {
        source: '/api/cache/upload',
        destination: 'http://192.168.250.121:3000/api/cache/upload',
      }
    ];
    
    return {
      beforeFiles: ret,
    };
  };
}

export default nextConfig;
