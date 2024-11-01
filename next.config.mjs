import webpack from "webpack";

const mode = process.env.BUILD_MODE ?? "standalone";
console.log("[Next] build mode", mode);

const disableChunk = !!process.env.DISABLE_CHUNK || mode === "export";
console.log("[Next] build with chunk: ", !disableChunk);

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

if (mode !== "export") {
  nextConfig.headers = async () => {
    return [
      {
        source: "/api/:path*",
        headers: CorsHeaders,
      },
      {
        // 添加 chat 路径的 CORS 配置
        source: "/chat/:path*",
        headers: CorsHeaders,
      },
      {
        // 添加 knowledge_base 路径的 CORS 配置
        source: "/knowledge_base/:path*",
        headers: CorsHeaders,
      },
    ];
  };

  nextConfig.rewrites = async () => {
    console.log('Configuring rewrites...');
    const ret = [
      // adjust for previous version directly using "/api/proxy/" as proxy base route
      // {
      //   source: "/api/proxy/v1/:path*",
      //   destination: "https://api.openai.com/v1/:path*",
      // },
      {
        // https://{resource_name}.openai.azure.com/openai/deployments/{deploy_name}/chat/completions
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
        source: '/chat/:path*',
        destination: 'http://192.168.250.122:7861/chat/:path*',
        basePath: false,
      },
      {
        source: '/kb_chat/:path*',
        destination: 'http://192.168.250.122:7861/kb_chat/:path*',
        basePath: false,
      },
      {
        source: '/knowledge_base/:path*',
        destination: 'http://192.168.250.122:7861/knowledge_base/:path*',
        basePath: false,
      },
    ];

    return {
      beforeFiles: ret,
    };
  };
  nextConfig.middleware = async function middleware(req) {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: Object.fromEntries(CorsHeaders.map(h => [h.key, h.value])),
      });
    }
    return null;
  };
}

export default nextConfig;
