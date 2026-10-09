export function qrFetchFixture() {
  const source = { calls: [], confirmed: false, scanned: false, fail: false };
  source.fetch = async (url, options) => {
    source.calls.push({ url, options });
    if (source.fail) return new Response(JSON.stringify({ retcode: -1, message: 'SECRET-UPSTREAM' }));
    let data = {}, status = 0, cookies;
    if (url.endsWith('createQRLogin')) data = { ticket: 'secret-ticket', url: 'https://user.mihoyo.com/qr?ticket=secret-ticket' };
    else if (url.endsWith('queryQRLoginStatus')) {
      data = { status: source.confirmed ? 'Confirmed' : source.scanned ? 'Scanned' : 'Created' };
      if (source.confirmed) cookies = [['Set-Cookie', 'cookie_token_v2=secret-cookie-token; Secure; HttpOnly'], ['Set-Cookie', 'account_id_v2=1234; Secure'], ['Set-Cookie', 'unrelated=DO-NOT-STORE; Secure']];
    } else if (url.endsWith('gen_scan/login')) data = { scanId: 'secret-scan-id' };
    else if (url.includes('scan_status?')) { status = source.confirmed ? 0 : source.expired ? 102 : source.scanned ? 101 : 100; data = { scanCode: 'secret-scan-code' }; }
    else if (url.endsWith('token_by_scan_code')) data = { token: 'secret-passport-token' };
    else if (url.endsWith('oauth2/v2/grant')) data = { code: 'secret-oauth-code' };
    else if (url.endsWith('generate_cred_by_code')) data = { cred: 'secret-skland-cred' };
    else throw new Error('Unexpected endpoint');
    return new Response(JSON.stringify({ status, data }), { headers: cookies || [] });
  };
  return source;
}
