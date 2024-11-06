import { BAIDU_OAUTH_URL } from "../constant";
/**
 * 使用 AK，SK 生成鉴权签名（Access Token）
 * @return 鉴权签名信息
 */
export async function getAccessToken(
  clientId: string,
  clientSecret: string,
): Promise<{
  access_token: string;
  expires_in: number;
  error?: number;
}> {
  console.log("1111111")
  const res = await fetch(
    `${BAIDU_OAUTH_URL}?grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`,
    {
      method: "POST",
      mode: "cors",
    },
  );
  const resJson = await res.json();

  console.log("[Baidu] getAccessToken", resJson);

  return resJson;
}
