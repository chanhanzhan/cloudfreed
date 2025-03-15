import makeRequest from './makeRequest.js';
import Proxy from './Proxy.js';

async function getContent(url, proxyConfig = null, cfClearance = null, userAgent = null) {
    try {
        const headers = {
            ...(userAgent && { 'User-Agent': userAgent }),
            ...(cfClearance && { 'Cookie': `cf_clearance=${cfClearance}` })
        };

        const isHttps = url.startsWith('https');
        let proxy = null;
        
        if (proxyConfig) {
            if (typeof proxyConfig === 'string') {
                // Handle string proxy format
                const isSocks5 = proxyConfig.startsWith('socks5://');
                proxy = new Proxy({
                    [isSocks5 ? 'socks' : (isHttps ? 'https' : 'http')]: proxyConfig
                });
            } else {
                // Handle object proxy format with auth support
                const auth = proxyConfig.username 
                    ? `${proxyConfig.username}:${proxyConfig.password}@`
                    : '';
                proxy = new Proxy({
                    [proxyConfig.scheme === 'socks5' ? 'socks' : (isHttps ? 'https' : 'http')]: 
                        proxyConfig.scheme === 'socks5' 
                            ? `socks5://${auth}${proxyConfig.host}:${proxyConfig.port}`
                            : `${proxyConfig.scheme}://${auth}${proxyConfig.host}:${proxyConfig.port}`
                });
            }
        }
        
        const options = {
            method: 'GET',
            headers,
            agent: proxy?.getAgent(),
            timeout: 30000,
        };

        const response = await makeRequest(url, options);
        const content = response.data;

        if (content.includes("cf-wrapper") || content.includes("Enable JavaScript and cookies to continue")) {
            return {
                success: false,
                response: content,
                status: response.status,
                headers: response.headers,
                error: "Cloudflare protection still detected."
            };
        }
        return {
            success: true,
            response: content,
            status: response.status,
            headers: response.headers,
            error: null
        };
    } catch (error) {
        return {
            success: false,
            response: null,
            status: null,
            headers: null,
            error: error.message
        };
    }
}

export default getContent;