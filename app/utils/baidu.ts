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
  const url = `/api/baidu/oauth/2.0/token?grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`
  const res = await fetch(url,
    {
      method: "POST",
      mode: "cors",
    },
  );
  return await res.json();
}
