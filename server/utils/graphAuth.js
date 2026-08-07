/**
 * Microsoft Graph API용 앱 전용(client credentials) 액세스 토큰 발급
 * outlookSyncService.js와 동일한 Azure AD 앱 등록(AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET)을 사용한다.
 */
export const getGraphAccessToken = async () => {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('Azure credentials (AZURE_TENANT_ID/AZURE_CLIENT_ID/AZURE_CLIENT_SECRET) are not set.');
  }

  const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  });

  const tokenRes = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!tokenRes.ok) {
    const errorText = await tokenRes.text();
    throw new Error(`Failed to obtain Graph access token: ${errorText}`);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
};
