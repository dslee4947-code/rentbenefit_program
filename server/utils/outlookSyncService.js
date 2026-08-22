import Customer from '../models/Customer.js';

/**
 * Microsoft Graph API를 사용하여 아웃룩의 모든 연락처 폴더(하위 폴더 포함)를 재귀 탐색하고 
 * MongoDB 고객 DB로 동기화하는 서비스 함수
 */
export const syncOutlookContacts = async () => {
  const tenantId = process.env.AZURE_TENANT_ID;
  const clientId = process.env.AZURE_CLIENT_ID;
  const clientSecret = process.env.AZURE_CLIENT_SECRET;
  const targetEmail = process.env.OUTLOOK_TARGET_EMAIL || 'as@sdibenefit.com';

  if (!tenantId || !clientId || !clientSecret) {
    console.error('[Outlook Sync Error] Azure environment variables are not set properly.');
    return { success: false, message: 'Azure credentials missing' };
  }

  try {
    console.log(`[Outlook Sync] Starting full recursive sync for target user: ${targetEmail}...`);

    // 1. OAuth2 Client Credentials 토큰 발급
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
      throw new Error(`Failed to obtain access token: ${errorText}`);
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    // Helper: 특정 Graph API URL에서 모든 연락처 수집 (페이지네이션 처리)
    const fetchContactsFromUrl = async (url, categoryName) => {
      let contacts = [];
      let nextLink = url;

      while (nextLink) {
        const res = await fetch(nextLink, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!res.ok) {
          const errorText = await res.text();
          console.error(`[Outlook Sync] Error fetching contacts for ${categoryName}: ${errorText}`);
          break;
        }

        const data = await res.json();
        const pageItems = (data.value || []).map(item => ({ ...item, _category: categoryName }));
        contacts.push(...pageItems);
        nextLink = data['@odata.nextLink'] || null;
      }
      return contacts;
    };

    const allContactsMap = new Map(); // ID 기반 중복 제거용 Map

    // 2-1. 최상위(Root) 기본 연락처 수집
    console.log('[Outlook Sync] Fetching root contacts...');
    const rootContacts = await fetchContactsFromUrl(
      `https://graph.microsoft.com/v1.0/users/${targetEmail}/contacts?$top=999`,
      '기본 연락처'
    );
    rootContacts.forEach(c => allContactsMap.set(c.id, c));
    console.log(`[Outlook Sync] Root contacts fetched: ${rootContacts.length}`);

    // 2-2. 모든 연락처 폴더 및 하위 폴더 재귀 수집
    const traverseFolders = async (foldersUrl, parentPath = '') => {
      const res = await fetch(foldersUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) return;

      const data = await res.json();
      const folders = data.value || [];

      for (const folder of folders) {
        const currentPath = parentPath ? `${parentPath} > ${folder.displayName}` : folder.displayName;

        // 해당 폴더 내의 연락처 수집
        const folderContactsUrl = `https://graph.microsoft.com/v1.0/users/${targetEmail}/contactFolders/${folder.id}/contacts?$top=999`;
        const folderContacts = await fetchContactsFromUrl(folderContactsUrl, currentPath);
        
        folderContacts.forEach(c => {
          if (!allContactsMap.has(c.id)) {
            allContactsMap.set(c.id, c);
          }
        });

        console.log(`[Outlook Sync] Folder "${currentPath}": ${folderContacts.length} contacts (Total so far: ${allContactsMap.size})`);

        // 하위 폴더(Child Folders) 재귀 탐색
        const childFoldersUrl = `https://graph.microsoft.com/v1.0/users/${targetEmail}/contactFolders/${folder.id}/childFolders?$top=100`;
        await traverseFolders(childFoldersUrl, currentPath);
      }
    };

    console.log('[Outlook Sync] Traversing all contact folders recursively...');
    await traverseFolders(`https://graph.microsoft.com/v1.0/users/${targetEmail}/contactFolders?$top=100`);

    const allContactsList = Array.from(allContactsMap.values());
    console.log(`[Outlook Sync] Total unique contacts collected across all folders: ${allContactsList.length}`);

    if (allContactsList.length === 0) {
      console.log('[Outlook Sync Completed] No contacts found in Outlook.');
      return { success: true, totalCount: 0, addedCount: 0, updatedCount: 0 };
    }

    // 3. DB bulkWrite 배치 업데이트 (1,000개씩 청크 분할 고속 저장)
    const customersWithId = await Customer.find({ customerId: /^CUST\d+$/ }, { customerId: 1 });
    let maxSeq = 0;
    for (const c of customersWithId) {
      const numStr = c.customerId.replace('CUST', '');
      const num = parseInt(numStr, 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
    let newCustomerSeq = maxSeq + 1;

    const chunkSize = 1000;
    let totalAdded = 0;
    let totalUpdated = 0;

    for (let i = 0; i < allContactsList.length; i += chunkSize) {
      const chunk = allContactsList.slice(i, i + chunkSize);
      
      const bulkOps = chunk.map((item, index) => {
        const outlookId = item.id;
        const surname = item.surname || '';
        const givenName = item.givenName || '';
        const companyName = item.companyName || '';
        const department = item.department || '';
        const jobTitle = item.jobTitle || '';
        const displayName = item.displayName || `${surname}${givenName}`.trim() || companyName || '이름 없음';
        
        const name = companyName || displayName;
        const contactName = displayName;
        
        const hasEmail = Boolean(item.emailAddresses && item.emailAddresses[0] && item.emailAddresses[0].address);
        const email = hasEmail ? item.emailAddresses[0].address : '';

        const mobilePhone = item.mobilePhone || '';
        const businessPhone = (item.businessPhones && item.businessPhones[0]) || '';
        const homePhone = (item.homePhones && item.homePhones[0]) || '';
        const contactPhone = mobilePhone || businessPhone || homePhone || '';
        const faxNumber = item.faxNumber || '';
        const webPage = item.businessHomePage || item.webPage || '';

        const bAddr = item.businessAddress || {};
        const hAddr = item.homeAddress || {};
        const businessAddressStr = [bAddr.street, bAddr.city, bAddr.state].filter(Boolean).join(' ');
        const homeAddressStr = [hAddr.street, hAddr.city, hAddr.state].filter(Boolean).join(' ');
        const addressStr = businessAddressStr || homeAddressStr;
        const postalCodeStr = bAddr.postalCode || hAddr.postalCode || '';

        const customerId = `CUST${String(newCustomerSeq + i + index).padStart(6, '0')}`;
        const outlookCategory = item._category || '기본 연락처';

        // Filter condition: If email exists, match by (outlookId OR email). Otherwise match ONLY by outlookId.
        const filter = hasEmail 
          ? { $or: [{ outlookId: outlookId }, { email: email }] }
          : { outlookId: outlookId };

        return {
          updateOne: {
            filter,
            update: {
              $set: {
                name,
                contactName,
                contactPhone,
                address: addressStr,
                outlookId,
                outlookCategory,
                email,
                source: 'outlook',
                // 상세 프로퍼티 매핑 (메모/body는 수집 제외)
                surname,
                givenName,
                companyName,
                department,
                jobTitle,
                displayName,
                mobilePhone,
                businessPhone,
                homePhone,
                faxNumber,
                webPage,
                postalCode: postalCodeStr,
                businessAddress: businessAddressStr,
                homeAddress: homeAddressStr
              },
              $setOnInsert: {
                customerId,
                ceoName: item.displayName || ''
              }
            },
            upsert: true
          }
        };
      });

      const bulkResult = await Customer.bulkWrite(bulkOps);
      totalAdded += bulkResult.upsertedCount || 0;
      totalUpdated += bulkResult.modifiedCount || 0;
    }

    console.log(`[Outlook Sync Completed] Total: ${allContactsList.length}, Added: ${totalAdded}, Updated: ${totalUpdated}`);
    return {
      success: true,
      totalCount: allContactsList.length,
      addedCount: totalAdded,
      updatedCount: totalUpdated,
    };
  } catch (error) {
    console.error('[Outlook Sync Error]:', error.message);
    return {
      success: false,
      message: error.message,
    };
  }
};
